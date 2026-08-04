import { NextRequest, NextResponse } from 'next/server';
import {
  executeApprovedGmailDraft,
  isGmailApprovalTool,
  type GmailApprovalDraft,
} from '@/lib/mcp/google/gmail-approval';
import { getGoogleAccessToken, resolveOwnerId } from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 30;

type ApproveBody = {
  action?: 'send' | 'cancel';
  draft?: GmailApprovalDraft;
};

export async function POST(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: ApproveBody;
  try {
    body = (await req.json()) as ApproveBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const action = body.action === 'cancel' ? 'cancel' : body.action === 'send' ? 'send' : null;
  if (!action) {
    return NextResponse.json({ error: 'action must be send or cancel.' }, { status: 400 });
  }

  if (action === 'cancel') {
    return NextResponse.json({
      ok: true,
      status: 'cancelled',
      message: 'User cancelled the email send.',
    });
  }

  const draft = body.draft;
  if (!draft || typeof draft !== 'object' || !isGmailApprovalTool(String(draft.tool || ''))) {
    return NextResponse.json({ error: 'Valid draft.tool is required.' }, { status: 400 });
  }

  const { token } = await getGoogleAccessToken(req, ownerId);
  if (!token) {
    return NextResponse.json({ error: 'Google Workspace is not connected.' }, { status: 401 });
  }

  try {
    const result = await executeApprovedGmailDraft(token, {
      ...draft,
      tool: draft.tool,
      to: String(draft.to || ''),
      subject: String(draft.subject || ''),
      body: String(draft.body || ''),
      cc: draft.cc ? String(draft.cc) : undefined,
      bcc: draft.bcc ? String(draft.bcc) : undefined,
      messageId: draft.messageId ? String(draft.messageId) : undefined,
      draftId: draft.draftId ? String(draft.draftId) : undefined,
      replyAll: Boolean(draft.replyAll),
    });
    return NextResponse.json({
      ok: true,
      status: 'sent',
      result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err || 'Send failed');
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
