/**
 * Human-in-the-loop gate for Gmail send/reply/forward/send_draft.
 * Model tool calls propose a draft; the user confirms (and may edit) in chat UI.
 */

import {
  gmailDeleteDraft,
  gmailForwardMessage,
  gmailGetMessage,
  gmailReplyMessage,
  gmailSendDraft,
  gmailSendMessage,
} from '@/lib/integrations/google/gmail';
import { googleGetJson, GMAIL_API, type GoogleRestJson } from '@/lib/integrations/google/client';
import { str } from '@/lib/mcp/google/shared';

export const GMAIL_APPROVAL_TOOLS = [
  'gmail_send',
  'gmail_reply',
  'gmail_forward',
  'gmail_send_draft',
] as const;

export type GmailApprovalToolName = (typeof GMAIL_APPROVAL_TOOLS)[number];

export type GmailApprovalDraft = {
  tool: GmailApprovalToolName;
  callId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  /** Original message for reply / forward. */
  messageId?: string;
  replyAll?: boolean;
  /** Existing draft id for gmail_send_draft. */
  draftId?: string;
};

export function isGmailApprovalTool(name: string): name is GmailApprovalToolName {
  return (GMAIL_APPROVAL_TOOLS as readonly string[]).includes(name);
}

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string {
  const target = name.toLowerCase();
  for (const h of headers || []) {
    if (String(h.name || '').toLowerCase() === target) return String(h.value || '');
  }
  return '';
}

function collectTextParts(payload: GoogleRestJson | undefined, out: string[]): void {
  if (!payload || typeof payload !== 'object') return;
  const mime = String(payload.mimeType || '');
  const body = payload.body as { data?: string } | undefined;
  if (mime.startsWith('text/') && body?.data) {
    try {
      const padded = body.data.replace(/-/g, '+').replace(/_/g, '/');
      const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
      const binary = atob(padded + pad);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      out.push(new TextDecoder().decode(bytes));
    } catch {
      /* ignore decode errors */
    }
  }
  const parts = payload.parts as GoogleRestJson[] | undefined;
  if (Array.isArray(parts)) {
    for (const part of parts) collectTextParts(part, out);
  }
}

/** Load a draft's To/Subject/body for the approval card. */
export async function gmailGetDraftForApproval(
  accessToken: string,
  draftId: string,
): Promise<{ to: string; cc: string; bcc: string; subject: string; body: string }> {
  const full = await googleGetJson(
    `${GMAIL_API}/users/me/drafts/${encodeURIComponent(draftId)}?format=full`,
    accessToken,
  );
  const message = full.message as GoogleRestJson | undefined;
  const payload = message?.payload as GoogleRestJson | undefined;
  const headers = (payload?.headers || []) as Array<{ name?: string; value?: string }>;
  const texts: string[] = [];
  collectTextParts(payload, texts);
  return {
    to: headerValue(headers, 'To'),
    cc: headerValue(headers, 'Cc'),
    bcc: headerValue(headers, 'Bcc'),
    subject: headerValue(headers, 'Subject'),
    body: texts.join('\n\n').slice(0, 50_000),
  };
}

/**
 * Build a user-editable draft from tool args.
 * Enriches reply/forward/send_draft with resolved headers when possible.
 */
export async function buildGmailApprovalDraft(
  accessToken: string,
  tool: GmailApprovalToolName,
  args: Record<string, unknown>,
  callId?: string,
): Promise<GmailApprovalDraft> {
  const base: GmailApprovalDraft = {
    tool,
    callId,
    to: str(args.to),
    cc: str(args.cc) || undefined,
    bcc: str(args.bcc) || undefined,
    subject: str(args.subject),
    body: str(args.body),
    messageId: str(args.messageId) || undefined,
    replyAll: Boolean(args.replyAll),
    draftId: str(args.draftId) || undefined,
  };

  if (tool === 'gmail_send') {
    return base;
  }

  if (tool === 'gmail_send_draft') {
    const draftId = base.draftId;
    if (!draftId) throw new Error('draftId is required');
    const loaded = await gmailGetDraftForApproval(accessToken, draftId);
    return {
      ...base,
      to: base.to || loaded.to,
      cc: base.cc || loaded.cc || undefined,
      bcc: base.bcc || loaded.bcc || undefined,
      subject: base.subject || loaded.subject,
      body: base.body || loaded.body,
      draftId,
    };
  }

  const messageId = base.messageId;
  if (!messageId) throw new Error('messageId is required');
  const original = await gmailGetMessage(accessToken, messageId);
  const from = String(original.from || '');
  const toHeader = String(original.to || '');
  const ccHeader = String(original.cc || '');
  const subjectRaw = String(original.subject || '');

  if (tool === 'gmail_reply') {
    let to = base.to || from;
    if (!base.to && from && toHeader && /me|self/i.test(from) === false) {
      to = from;
    }
    let cc = base.cc;
    if (base.replyAll) {
      const parts = [toHeader, ccHeader]
        .join(',')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const unique = Array.from(new Set(parts)).filter((addr) => addr !== to);
      cc = unique.join(', ') || undefined;
    }
    const subject =
      base.subject ||
      (/^re:\s/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw || '(no subject)'}`);
    return { ...base, to, cc, subject, messageId };
  }

  // gmail_forward
  const subject =
    base.subject ||
    (/^fwd:\s/i.test(subjectRaw) ? subjectRaw : `Fwd: ${subjectRaw || '(no subject)'}`);
  const preface = base.body;
  const quoted = [
    preface,
    preface ? '' : null,
    '---------- Forwarded message ---------',
    `From: ${original.from || ''}`,
    `Date: ${original.date || ''}`,
    `Subject: ${original.subject || ''}`,
    `To: ${original.to || ''}`,
    '',
    String(original.bodyText || original.snippet || ''),
  ]
    .filter((line) => line !== null)
    .join('\n')
    .slice(0, 50_000);
  return {
    ...base,
    to: base.to,
    subject,
    body: quoted,
    messageId,
  };
}

/** Execute a user-approved (possibly edited) Gmail send action. */
export async function executeApprovedGmailDraft(
  accessToken: string,
  draft: GmailApprovalDraft,
): Promise<unknown> {
  const tool = draft.tool;
  const to = String(draft.to || '').trim();
  const subject = String(draft.subject || '').trim();
  const body = String(draft.body || '');
  const cc = String(draft.cc || '').trim() || undefined;
  const bcc = String(draft.bcc || '').trim() || undefined;

  if (tool === 'gmail_send') {
    if (!to || !subject || !body.trim()) throw new Error('to, subject, and body are required');
    return gmailSendMessage(accessToken, { to, subject, body, cc, bcc });
  }

  if (tool === 'gmail_reply') {
    const messageId = String(draft.messageId || '').trim();
    if (!messageId || !body.trim()) throw new Error('messageId and body are required');
    return gmailReplyMessage(accessToken, {
      messageId,
      body,
      replyAll: Boolean(draft.replyAll),
      to: to || undefined,
      cc,
      subject: subject || undefined,
    });
  }

  if (tool === 'gmail_forward') {
    const messageId = String(draft.messageId || '').trim();
    if (!messageId || !to) throw new Error('messageId and to are required');
    // Body already includes the forwarded quote from the approval card.
    return gmailSendMessage(accessToken, { to, subject: subject || 'Fwd:', body, cc, bcc });
  }

  // gmail_send_draft — if the user edited fields, send as a new message and drop the draft;
  // otherwise send the stored draft as-is.
  const draftId = String(draft.draftId || '').trim();
  if (!draftId) throw new Error('draftId is required');
  if (to && subject && body.trim()) {
    const result = await gmailSendMessage(accessToken, { to, subject, body, cc, bcc });
    try {
      await gmailDeleteDraft(accessToken, draftId);
    } catch {
      /* draft may already be gone after send in some clients */
    }
    return result;
  }
  return gmailSendDraft(accessToken, draftId);
}

/** Tool result payload while waiting for the user (model must not claim sent). */
export function awaitingApprovalToolResult(draft: GmailApprovalDraft): string {
  return JSON.stringify({
    ok: true,
    status: 'awaiting_user_approval',
    tool: draft.tool,
    message:
      'Email is NOT sent yet. A compose card is shown to the user for review. Wait for them to press Send or Cancel. Do not claim the email was sent.',
    draft: {
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      bodyPreview: String(draft.body || '').slice(0, 400),
      messageId: draft.messageId,
      draftId: draft.draftId,
    },
  });
}
