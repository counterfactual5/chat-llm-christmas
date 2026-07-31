import {
  GMAIL_API,
  googleGetJson,
  googleSendJson,
  type GoogleRestJson,
} from '@/lib/integrations/google/client';

function encodeBase64Url(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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
    out.push(decodeBase64Url(body.data));
  }
  const parts = payload.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (part && typeof part === 'object') collectTextParts(part as GoogleRestJson, out);
    }
  }
}

function buildMimeMessage(opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${opts.subject}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    opts.body,
  ];
  return lines.join('\r\n');
}

function collectAttachments(
  payload: GoogleRestJson | undefined,
  out: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }>,
): void {
  if (!payload || typeof payload !== 'object') return;
  const filename = String(payload.filename || '');
  const body = payload.body as { attachmentId?: string; size?: number } | undefined;
  if (filename && body?.attachmentId) {
    out.push({
      attachmentId: body.attachmentId,
      filename,
      mimeType: String(payload.mimeType || 'application/octet-stream'),
      size: Number(body.size || 0),
    });
  }
  const parts = payload.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (part && typeof part === 'object') collectAttachments(part as GoogleRestJson, out);
    }
  }
}

// —— Gmail ——

export async function gmailGetProfile(accessToken: string) {
  return googleGetJson(`${GMAIL_API}/users/me/profile`, accessToken);
}

export async function gmailListLabels(accessToken: string) {
  return googleGetJson(`${GMAIL_API}/users/me/labels`, accessToken);
}

/** Fetch several messages by id (metadata + short body). Caps at 20. */
export async function gmailBatchGetMessages(
  accessToken: string,
  messageIds: string[],
) {
  const ids = Array.from(
    new Set(
      (messageIds || [])
        .map((x) => String(x || '').trim())
        .filter(Boolean),
    ),
  ).slice(0, 20);
  if (!ids.length) throw new Error('messageIds is required');
  const messages = [];
  for (const id of ids) {
    messages.push(await gmailGetMessage(accessToken, id));
  }
  return { count: messages.length, messages };
}

export async function gmailSearchMessages(
  accessToken: string,
  opts: { query?: string; maxResults?: number; pageToken?: string },
) {
  const params = new URLSearchParams();
  if (opts.query) params.set('q', opts.query);
  params.set('maxResults', String(Math.min(Math.max(opts.maxResults || 10, 1), 50)));
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  const list = await googleGetJson(
    `${GMAIL_API}/users/me/messages?${params.toString()}`,
    accessToken,
  );
  const ids = Array.isArray(list.messages)
    ? (list.messages as Array<{ id?: string }>).map((m) => m.id).filter(Boolean)
    : [];
  const messages = [];
  for (const id of ids.slice(0, 15)) {
    const meta = await googleGetJson(
      `${GMAIL_API}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      accessToken,
    );
    const payload = meta.payload as GoogleRestJson | undefined;
    const headers = (payload?.headers || []) as Array<{ name?: string; value?: string }>;
    messages.push({
      id: meta.id,
      threadId: meta.threadId,
      snippet: meta.snippet,
      labelIds: meta.labelIds,
      from: headerValue(headers, 'From'),
      to: headerValue(headers, 'To'),
      subject: headerValue(headers, 'Subject'),
      date: headerValue(headers, 'Date'),
    });
  }
  return {
    resultSizeEstimate: list.resultSizeEstimate,
    nextPageToken: list.nextPageToken,
    messages,
  };
}

export async function gmailGetMessage(accessToken: string, messageId: string) {
  const msg = await googleGetJson(
    `${GMAIL_API}/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    accessToken,
  );
  const payload = msg.payload as GoogleRestJson | undefined;
  const headers = (payload?.headers || []) as Array<{ name?: string; value?: string }>;
  const texts: string[] = [];
  collectTextParts(payload, texts);
  const attachments: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }> = [];
  collectAttachments(payload, attachments);
  return {
    id: msg.id,
    threadId: msg.threadId,
    snippet: msg.snippet,
    labelIds: msg.labelIds,
    from: headerValue(headers, 'From'),
    to: headerValue(headers, 'To'),
    cc: headerValue(headers, 'Cc'),
    subject: headerValue(headers, 'Subject'),
    date: headerValue(headers, 'Date'),
    messageIdHeader: headerValue(headers, 'Message-ID') || headerValue(headers, 'Message-Id'),
    bodyText: texts.join('\n\n').slice(0, 20_000),
    attachments,
  };
}

export async function gmailGetAttachment(
  accessToken: string,
  opts: { messageId: string; attachmentId: string },
) {
  const messageId = encodeURIComponent(opts.messageId);
  const attachmentId = encodeURIComponent(opts.attachmentId);
  const data = await googleGetJson(
    `${GMAIL_API}/users/me/messages/${messageId}/attachments/${attachmentId}`,
    accessToken,
  );
  const raw = String(data.data || '');
  const size = Number(data.size || 0);
  // Prefer decoded text for text-like payloads; otherwise return truncated base64.
  let textPreview = '';
  try {
    textPreview = decodeBase64Url(raw).slice(0, 20_000);
  } catch {
    textPreview = '';
  }
  const looksBinary = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(textPreview.slice(0, 200));
  return {
    messageId: opts.messageId,
    attachmentId: opts.attachmentId,
    size,
    ...(looksBinary
      ? {
          encoding: 'base64url',
          dataPreview: raw.slice(0, 4_000),
          note: 'Binary attachment; dataPreview is truncated base64url.',
        }
      : { encoding: 'utf-8', text: textPreview }),
  };
}

export async function gmailCreateDraft(
  accessToken: string,
  opts: { to: string; subject: string; body: string; cc?: string; bcc?: string },
) {
  const raw = encodeBase64Url(buildMimeMessage(opts));
  return googleSendJson(`${GMAIL_API}/users/me/drafts`, accessToken, 'POST', {
    message: { raw },
  });
}

export async function gmailSendMessage(
  accessToken: string,
  opts: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  },
) {
  const raw = encodeBase64Url(
    buildMimeMessage({
      to: opts.to,
      subject: opts.subject,
      body: opts.body,
      cc: opts.cc,
      bcc: opts.bcc,
      inReplyTo: opts.inReplyTo,
      references: opts.references,
    }),
  );
  const body: GoogleRestJson = { raw };
  if (opts.threadId) body.threadId = opts.threadId;
  return googleSendJson(`${GMAIL_API}/users/me/messages/send`, accessToken, 'POST', body);
}

/** Reply in-thread: loads original headers and sends with In-Reply-To / References. */
export async function gmailReplyMessage(
  accessToken: string,
  opts: {
    messageId: string;
    body: string;
    replyAll?: boolean;
    to?: string;
    cc?: string;
    subject?: string;
  },
) {
  const original = await gmailGetMessage(accessToken, opts.messageId);
  const from = String(original.from || '');
  const toHeader = String(original.to || '');
  const ccHeader = String(original.cc || '');
  const subjectRaw = String(original.subject || '');
  const messageIdHeader = String(original.messageIdHeader || '');
  const subject =
    opts.subject ||
    (/^re:\s/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw || '(no subject)'}`);

  let to = opts.to || from;
  // Prefer the other party: if From is us, fall back to original To.
  if (!opts.to && from && toHeader && /me|self/i.test(from) === false) {
    to = from;
  }
  let cc = opts.cc;
  if (opts.replyAll) {
    const parts = [toHeader, ccHeader]
      .join(',')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Keep unique addresses excluding the primary To we're already using.
    const unique = Array.from(new Set(parts)).filter((addr) => addr !== to);
    cc = unique.join(', ') || undefined;
  }

  return gmailSendMessage(accessToken, {
    to,
    subject,
    body: opts.body,
    cc,
    threadId: String(original.threadId || '') || undefined,
    inReplyTo: messageIdHeader || undefined,
    references: messageIdHeader || undefined,
  });
}

function asIdList(raw: unknown, max = 100): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (typeof x === 'string' ? x.trim() : String(x || '').trim()))
    .filter(Boolean)
    .slice(0, max);
}

/** Add/remove labels on a single message (read/unread, star, archive, custom labels). */
export async function gmailModifyMessage(
  accessToken: string,
  opts: { messageId: string; addLabelIds?: string[]; removeLabelIds?: string[] },
) {
  const messageId = encodeURIComponent(opts.messageId);
  return googleSendJson(`${GMAIL_API}/users/me/messages/${messageId}/modify`, accessToken, 'POST', {
    addLabelIds: opts.addLabelIds || [],
    removeLabelIds: opts.removeLabelIds || [],
  });
}

/** Batch add/remove labels (e.g. mark many messages read). Max 1000 ids per Gmail API call. */
export async function gmailBatchModifyMessages(
  accessToken: string,
  opts: { messageIds: string[]; addLabelIds?: string[]; removeLabelIds?: string[] },
) {
  const ids = asIdList(opts.messageIds, 1000);
  if (!ids.length) throw new Error('messageIds is required');
  await googleSendJson(`${GMAIL_API}/users/me/messages/batchModify`, accessToken, 'POST', {
    ids,
    addLabelIds: opts.addLabelIds || [],
    removeLabelIds: opts.removeLabelIds || [],
  });
  return { ok: true, modified: ids.length, ids };
}

export async function gmailTrashMessage(accessToken: string, messageId: string) {
  return googleSendJson(
    `${GMAIL_API}/users/me/messages/${encodeURIComponent(messageId)}/trash`,
    accessToken,
    'POST',
  );
}

export async function gmailUntrashMessage(accessToken: string, messageId: string) {
  return googleSendJson(
    `${GMAIL_API}/users/me/messages/${encodeURIComponent(messageId)}/untrash`,
    accessToken,
    'POST',
  );
}

export async function gmailListThreads(
  accessToken: string,
  opts: { query?: string; maxResults?: number; pageToken?: string },
) {
  const params = new URLSearchParams();
  if (opts.query) params.set('q', opts.query);
  params.set('maxResults', String(Math.min(Math.max(opts.maxResults || 10, 1), 50)));
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  const list = await googleGetJson(
    `${GMAIL_API}/users/me/threads?${params.toString()}`,
    accessToken,
  );
  const ids = Array.isArray(list.threads)
    ? (list.threads as Array<{ id?: string }>).map((t) => t.id).filter(Boolean)
    : [];
  const threads = [];
  for (const id of ids.slice(0, 15)) {
    const meta = await googleGetJson(
      `${GMAIL_API}/users/me/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      accessToken,
    );
    const messages = Array.isArray(meta.messages) ? (meta.messages as GoogleRestJson[]) : [];
    const first = messages[0];
    const payload = first?.payload as GoogleRestJson | undefined;
    const headers = (payload?.headers || []) as Array<{ name?: string; value?: string }>;
    threads.push({
      id: meta.id,
      historyId: meta.historyId,
      snippet: meta.snippet,
      messageCount: messages.length,
      from: headerValue(headers, 'From'),
      to: headerValue(headers, 'To'),
      subject: headerValue(headers, 'Subject'),
      date: headerValue(headers, 'Date'),
      labelIds: first?.labelIds,
    });
  }
  return {
    resultSizeEstimate: list.resultSizeEstimate,
    nextPageToken: list.nextPageToken,
    threads,
  };
}

export async function gmailGetThread(accessToken: string, threadId: string) {
  const thread = await googleGetJson(
    `${GMAIL_API}/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
    accessToken,
  );
  const messages = Array.isArray(thread.messages) ? (thread.messages as GoogleRestJson[]) : [];
  return {
    id: thread.id,
    historyId: thread.historyId,
    snippet: thread.snippet,
    messages: messages.map((msg) => {
      const payload = msg.payload as GoogleRestJson | undefined;
      const headers = (payload?.headers || []) as Array<{ name?: string; value?: string }>;
      const texts: string[] = [];
      collectTextParts(payload, texts);
      return {
        id: msg.id,
        threadId: msg.threadId,
        snippet: msg.snippet,
        labelIds: msg.labelIds,
        from: headerValue(headers, 'From'),
        to: headerValue(headers, 'To'),
        cc: headerValue(headers, 'Cc'),
        subject: headerValue(headers, 'Subject'),
        date: headerValue(headers, 'Date'),
        bodyText: texts.join('\n\n').slice(0, 12_000),
      };
    }),
  };
}

export async function gmailListDrafts(
  accessToken: string,
  opts: { maxResults?: number; pageToken?: string } = {},
) {
  const params = new URLSearchParams();
  params.set('maxResults', String(Math.min(Math.max(opts.maxResults || 10, 1), 50)));
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  const list = await googleGetJson(
    `${GMAIL_API}/users/me/drafts?${params.toString()}`,
    accessToken,
  );
  const draftsMeta = Array.isArray(list.drafts)
    ? (list.drafts as Array<{ id?: string; message?: { id?: string } }>)
    : [];
  const drafts = [];
  for (const d of draftsMeta.slice(0, 15)) {
    const draftId = d.id;
    if (!draftId) continue;
    const full = await googleGetJson(
      `${GMAIL_API}/users/me/drafts/${encodeURIComponent(draftId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      accessToken,
    );
    const message = full.message as GoogleRestJson | undefined;
    const payload = message?.payload as GoogleRestJson | undefined;
    const headers = (payload?.headers || []) as Array<{ name?: string; value?: string }>;
    drafts.push({
      id: full.id,
      messageId: message?.id,
      snippet: message?.snippet,
      from: headerValue(headers, 'From'),
      to: headerValue(headers, 'To'),
      subject: headerValue(headers, 'Subject'),
      date: headerValue(headers, 'Date'),
    });
  }
  return {
    resultSizeEstimate: list.resultSizeEstimate,
    nextPageToken: list.nextPageToken,
    drafts,
  };
}

export async function gmailDeleteDraft(accessToken: string, draftId: string) {
  await googleSendJson(
    `${GMAIL_API}/users/me/drafts/${encodeURIComponent(draftId)}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, deleted: draftId };
}

export async function gmailSendDraft(accessToken: string, draftId: string) {
  return googleSendJson(`${GMAIL_API}/users/me/drafts/send`, accessToken, 'POST', {
    id: draftId,
  });
}

export async function gmailCreateLabel(
  accessToken: string,
  opts: { name: string; messageListVisibility?: string; labelListVisibility?: string },
) {
  return googleSendJson(`${GMAIL_API}/users/me/labels`, accessToken, 'POST', {
    name: opts.name,
    messageListVisibility: opts.messageListVisibility || 'show',
    labelListVisibility: opts.labelListVisibility || 'labelShow',
  });
}

export async function gmailUpdateLabel(
  accessToken: string,
  opts: {
    labelId: string;
    name?: string;
    messageListVisibility?: string;
    labelListVisibility?: string;
  },
) {
  const body: GoogleRestJson = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.messageListVisibility !== undefined) {
    body.messageListVisibility = opts.messageListVisibility;
  }
  if (opts.labelListVisibility !== undefined) {
    body.labelListVisibility = opts.labelListVisibility;
  }
  return googleSendJson(
    `${GMAIL_API}/users/me/labels/${encodeURIComponent(opts.labelId)}`,
    accessToken,
    'PATCH',
    body,
  );
}

export async function gmailDeleteLabel(accessToken: string, labelId: string) {
  await googleSendJson(
    `${GMAIL_API}/users/me/labels/${encodeURIComponent(labelId)}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, deleted: labelId };
}

/** Forward a message to a new recipient (plain-text body with original quoted). */
export async function gmailForwardMessage(
  accessToken: string,
  opts: { messageId: string; to: string; body?: string; cc?: string; bcc?: string },
) {
  const original = await gmailGetMessage(accessToken, opts.messageId);
  const subjectRaw = String(original.subject || '');
  const subject = /^fwd:\s/i.test(subjectRaw)
    ? subjectRaw
    : `Fwd: ${subjectRaw || '(no subject)'}`;
  const preface = String(opts.body || '').trim();
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
    .join('\n');
  return gmailSendMessage(accessToken, {
    to: opts.to,
    subject,
    body: quoted.slice(0, 50_000),
    cc: opts.cc,
    bcc: opts.bcc,
  });
}

