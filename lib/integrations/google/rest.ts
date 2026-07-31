/**
 * Google Workspace REST helpers (Gmail / Calendar / Drive).
 * Edge-safe fetch wrappers — no MCP / developer-preview gate.
 */

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

export type GoogleRestJson = Record<string, unknown>;

function authHeaders(accessToken: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...extra,
  };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // ignore
  }
  return text.slice(0, 280) || response.statusText || `HTTP ${response.status}`;
}

export async function googleGetJson(
  url: string,
  accessToken: string,
): Promise<GoogleRestJson> {
  const response = await fetch(url, {
    method: 'GET',
    headers: authHeaders(accessToken),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as GoogleRestJson;
}

export async function googleSendJson(
  url: string,
  accessToken: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<GoogleRestJson | null> {
  const response = await fetch(url, {
    method,
    headers: authHeaders(accessToken, body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as GoogleRestJson;
}

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

// —— Calendar ——

export async function calendarListCalendars(accessToken: string) {
  return googleGetJson(`${CALENDAR_API}/users/me/calendarList?maxResults=50`, accessToken);
}

export async function calendarListEvents(
  accessToken: string,
  opts: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    query?: string;
    maxResults?: number;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(Math.min(Math.max(opts.maxResults || 20, 1), 50)),
  });
  if (opts.timeMin) params.set('timeMin', opts.timeMin);
  if (opts.timeMax) params.set('timeMax', opts.timeMax);
  if (opts.query) params.set('q', opts.query);
  if (!opts.timeMin && !opts.query) {
    params.set('timeMin', new Date().toISOString());
  }
  return googleGetJson(
    `${CALENDAR_API}/calendars/${calendarId}/events?${params.toString()}`,
    accessToken,
  );
}

export async function calendarCreateEvent(
  accessToken: string,
  opts: {
    calendarId?: string;
    summary: string;
    description?: string;
    location?: string;
    start: string;
    end: string;
    timeZone?: string;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const tz = opts.timeZone || 'UTC';
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(opts.start) && /^\d{4}-\d{2}-\d{2}$/.test(opts.end);
  const body = {
    summary: opts.summary,
    description: opts.description,
    location: opts.location,
    start: allDay ? { date: opts.start } : { dateTime: opts.start, timeZone: tz },
    end: allDay ? { date: opts.end } : { dateTime: opts.end, timeZone: tz },
  };
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events`,
    accessToken,
    'POST',
    body,
  );
}

export async function calendarUpdateEvent(
  accessToken: string,
  opts: {
    calendarId?: string;
    eventId: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    timeZone?: string;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  const tz = opts.timeZone || 'UTC';
  const patch: GoogleRestJson = {};
  if (opts.summary !== undefined) patch.summary = opts.summary;
  if (opts.description !== undefined) patch.description = opts.description;
  if (opts.location !== undefined) patch.location = opts.location;
  if (opts.start) {
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(opts.start);
    patch.start = allDay ? { date: opts.start } : { dateTime: opts.start, timeZone: tz };
  }
  if (opts.end) {
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(opts.end);
    patch.end = allDay ? { date: opts.end } : { dateTime: opts.end, timeZone: tz };
  }
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}`,
    accessToken,
    'PATCH',
    patch,
  );
}

export async function calendarDeleteEvent(
  accessToken: string,
  opts: { calendarId?: string; eventId: string },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  await googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, eventId: opts.eventId };
}

export async function calendarGetEvent(
  accessToken: string,
  opts: { calendarId?: string; eventId: string },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  return googleGetJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}`,
    accessToken,
  );
}

/** Move an event to another calendar. */
export async function calendarMoveEvent(
  accessToken: string,
  opts: { calendarId?: string; eventId: string; destinationCalendarId: string },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  const destination = encodeURIComponent(opts.destinationCalendarId);
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}/move?destination=${destination}`,
    accessToken,
    'POST',
  );
}

/** Query free/busy for one or more calendars in a time window. */
export async function calendarFreeBusy(
  accessToken: string,
  opts: {
    timeMin: string;
    timeMax: string;
    calendarIds?: string[];
    timeZone?: string;
  },
) {
  const ids = (opts.calendarIds && opts.calendarIds.length
    ? opts.calendarIds
    : ['primary']
  ).map((id) => String(id || '').trim()).filter(Boolean);
  return googleSendJson(`${CALENDAR_API}/freeBusy`, accessToken, 'POST', {
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    timeZone: opts.timeZone || 'UTC',
    items: ids.map((id) => ({ id })),
  });
}

/** Expand instances of a recurring event. */
export async function calendarListEventInstances(
  accessToken: string,
  opts: {
    calendarId?: string;
    eventId: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const eventId = encodeURIComponent(opts.eventId);
  const params = new URLSearchParams({
    maxResults: String(Math.min(Math.max(opts.maxResults || 20, 1), 50)),
  });
  if (opts.timeMin) params.set('timeMin', opts.timeMin);
  if (opts.timeMax) params.set('timeMax', opts.timeMax);
  return googleGetJson(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}/instances?${params.toString()}`,
    accessToken,
  );
}

export async function calendarCreateCalendar(
  accessToken: string,
  opts: { summary: string; description?: string; timeZone?: string },
) {
  return googleSendJson(`${CALENDAR_API}/calendars`, accessToken, 'POST', {
    summary: opts.summary,
    description: opts.description,
    timeZone: opts.timeZone || 'UTC',
  });
}

export async function calendarListAcl(
  accessToken: string,
  opts: { calendarId?: string } = {},
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  return googleGetJson(
    `${CALENDAR_API}/calendars/${calendarId}/acl?maxResults=100`,
    accessToken,
  );
}

export async function calendarInsertAcl(
  accessToken: string,
  opts: {
    calendarId?: string;
    role: 'none' | 'freeBusyReader' | 'reader' | 'writer' | 'owner';
    scopeType: 'default' | 'user' | 'group' | 'domain';
    scopeValue?: string;
  },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  const body: GoogleRestJson = {
    role: opts.role,
    scope: { type: opts.scopeType },
  };
  if (opts.scopeValue) (body.scope as GoogleRestJson).value = opts.scopeValue;
  return googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/acl`,
    accessToken,
    'POST',
    body,
  );
}

export async function calendarDeleteAcl(
  accessToken: string,
  opts: { calendarId?: string; ruleId: string },
) {
  const calendarId = encodeURIComponent(opts.calendarId || 'primary');
  await googleSendJson(
    `${CALENDAR_API}/calendars/${calendarId}/acl/${encodeURIComponent(opts.ruleId)}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, deleted: opts.ruleId };
}

// —— Drive ——

export async function driveSearchFiles(
  accessToken: string,
  opts: { query?: string; pageSize?: number; pageToken?: string },
) {
  const params = new URLSearchParams({
    pageSize: String(Math.min(Math.max(opts.pageSize || 10, 1), 50)),
    fields:
      'nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size,owners,parents)',
  });
  if (opts.query) params.set('q', opts.query);
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  return googleGetJson(`${DRIVE_API}/files?${params.toString()}`, accessToken);
}

export async function driveGetFile(accessToken: string, fileId: string) {
  const params = new URLSearchParams({
    fields:
      'id,name,mimeType,webViewLink,webContentLink,modifiedTime,size,owners,parents,description',
  });
  return googleGetJson(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    accessToken,
  );
}

export async function driveReadFileText(accessToken: string, fileId: string) {
  const meta = await driveGetFile(accessToken, fileId);
  const mime = String(meta.mimeType || '');
  let text = '';

  if (mime.startsWith('application/vnd.google-apps.')) {
    const exportMime =
      mime === 'application/vnd.google-apps.spreadsheet'
        ? 'text/csv'
        : 'text/plain';
    const response = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
      { headers: authHeaders(accessToken), cache: 'no-store' },
    );
    if (!response.ok) throw new Error(await readError(response));
    text = await response.text();
  } else {
    const response = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: authHeaders(accessToken), cache: 'no-store' },
    );
    if (!response.ok) throw new Error(await readError(response));
    text = await response.text();
  }

  return {
    id: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    webViewLink: meta.webViewLink,
    text: text.slice(0, 40_000),
  };
}

export async function driveCreateTextFile(
  accessToken: string,
  opts: { name: string; content: string; parentId?: string; mimeType?: string },
) {
  const mimeType = opts.mimeType || 'text/plain';
  const metadata: GoogleRestJson = { name: opts.name, mimeType };
  if (opts.parentId) metadata.parents = [opts.parentId];

  const boundary = `christmas_${Date.now().toString(36)}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}; charset=UTF-8`,
    '',
    opts.content,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink',
    {
      method: 'POST',
      headers: authHeaders(accessToken, {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      }),
      body,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as GoogleRestJson;
}

export async function driveCreateFolder(
  accessToken: string,
  opts: { name: string; parentId?: string },
) {
  const metadata: GoogleRestJson = {
    name: opts.name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (opts.parentId) metadata.parents = [opts.parentId];
  return googleSendJson(
    `${DRIVE_API}/files?fields=id,name,mimeType,webViewLink,parents`,
    accessToken,
    'POST',
    metadata,
  );
}

export async function driveCopyFile(
  accessToken: string,
  opts: { fileId: string; name?: string; parentId?: string },
) {
  const body: GoogleRestJson = {};
  if (opts.name) body.name = opts.name;
  if (opts.parentId) body.parents = [opts.parentId];
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/copy?fields=id,name,mimeType,webViewLink,parents`,
    accessToken,
    'POST',
    body,
  );
}

/** Rename and/or move a file (update parents via addParents/removeParents). */
export async function driveUpdateFile(
  accessToken: string,
  opts: {
    fileId: string;
    name?: string;
    description?: string;
    addParents?: string[];
    removeParents?: string[];
  },
) {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,webViewLink,parents,description',
  });
  if (opts.addParents?.length) params.set('addParents', opts.addParents.join(','));
  if (opts.removeParents?.length) params.set('removeParents', opts.removeParents.join(','));
  const body: GoogleRestJson = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.description !== undefined) body.description = opts.description;
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}?${params.toString()}`,
    accessToken,
    'PATCH',
    body,
  );
}

export async function driveTrashFile(accessToken: string, fileId: string) {
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,trashed,webViewLink`,
    accessToken,
    'PATCH',
    { trashed: true },
  );
}

export async function driveUntrashFile(accessToken: string, fileId: string) {
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,trashed,webViewLink`,
    accessToken,
    'PATCH',
    { trashed: false },
  );
}

export async function driveDeleteFile(accessToken: string, fileId: string) {
  await googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, deleted: fileId };
}

/** Export a Google Docs/Sheets/Slides file to a target MIME (returns text/base64-safe text). */
export async function driveExportFile(
  accessToken: string,
  opts: { fileId: string; mimeType?: string },
) {
  const meta = await driveGetFile(accessToken, opts.fileId);
  const mime = String(meta.mimeType || '');
  let exportMime = opts.mimeType;
  if (!exportMime) {
    if (mime === 'application/vnd.google-apps.spreadsheet') exportMime = 'text/csv';
    else if (mime === 'application/vnd.google-apps.presentation') {
      exportMime = 'text/plain';
    } else {
      exportMime = 'text/plain';
    }
  }
  const response = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
    { headers: authHeaders(accessToken), cache: 'no-store' },
  );
  if (!response.ok) throw new Error(await readError(response));
  const text = await response.text();
  return {
    id: meta.id,
    name: meta.name,
    sourceMimeType: meta.mimeType,
    exportMimeType: exportMime,
    webViewLink: meta.webViewLink,
    content: text.slice(0, 40_000),
  };
}

export async function driveListPermissions(accessToken: string, fileId: string) {
  const params = new URLSearchParams({
    fields:
      'permissions(id,type,role,emailAddress,domain,displayName,photoLink,allowFileDiscovery)',
    pageSize: '100',
  });
  return googleGetJson(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?${params.toString()}`,
    accessToken,
  );
}

export async function driveShareFile(
  accessToken: string,
  opts: {
    fileId: string;
    role: 'reader' | 'commenter' | 'writer' | 'owner';
    type: 'user' | 'group' | 'domain' | 'anyone';
    emailAddress?: string;
    domain?: string;
    sendNotificationEmail?: boolean;
  },
) {
  const body: GoogleRestJson = {
    role: opts.role,
    type: opts.type,
  };
  if (opts.emailAddress) body.emailAddress = opts.emailAddress;
  if (opts.domain) body.domain = opts.domain;
  const params = new URLSearchParams({
    fields: 'id,type,role,emailAddress,domain,displayName',
    sendNotificationEmail: opts.sendNotificationEmail === false ? 'false' : 'true',
  });
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/permissions?${params.toString()}`,
    accessToken,
    'POST',
    body,
  );
}

export async function driveRevokePermission(
  accessToken: string,
  opts: { fileId: string; permissionId: string },
) {
  await googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/permissions/${encodeURIComponent(opts.permissionId)}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, fileId: opts.fileId, permissionId: opts.permissionId };
}

export async function driveCreateShortcut(
  accessToken: string,
  opts: { targetId: string; name?: string; parentId?: string },
) {
  const metadata: GoogleRestJson = {
    mimeType: 'application/vnd.google-apps.shortcut',
    shortcutDetails: { targetId: opts.targetId },
  };
  if (opts.name) metadata.name = opts.name;
  if (opts.parentId) metadata.parents = [opts.parentId];
  return googleSendJson(
    `${DRIVE_API}/files?fields=id,name,mimeType,webViewLink,shortcutDetails,parents`,
    accessToken,
    'POST',
    metadata,
  );
}

export async function driveListSharedDrives(
  accessToken: string,
  opts: { pageSize?: number; pageToken?: string } = {},
) {
  const params = new URLSearchParams({
    pageSize: String(Math.min(Math.max(opts.pageSize || 20, 1), 50)),
    fields: 'nextPageToken,drives(id,name,createdTime)',
  });
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  return googleGetJson(`${DRIVE_API}/drives?${params.toString()}`, accessToken);
}

/** Upload a file from utf-8 text or base64 payload. */
export async function driveUploadFile(
  accessToken: string,
  opts: {
    name: string;
    mimeType?: string;
    parentId?: string;
    content?: string;
    contentBase64?: string;
  },
) {
  const mimeType = opts.mimeType || 'application/octet-stream';
  const metadata: GoogleRestJson = { name: opts.name, mimeType };
  if (opts.parentId) metadata.parents = [opts.parentId];

  let binary: Uint8Array;
  if (opts.contentBase64) {
    const padded = opts.contentBase64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const raw = atob(padded + pad);
    binary = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } else {
    binary = new TextEncoder().encode(opts.content || '');
  }
  // Cap upload size in chat context (~1.5MB decoded).
  if (binary.byteLength > 1_500_000) {
    throw new Error('Upload too large for chat tool (max ~1.5MB). Use Drive UI for bigger files.');
  }

  const boundary = `christmas_${Date.now().toString(36)}`;
  const metaPart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    'Content-Transfer-Encoding: binary',
    '',
  ].join('\r\n');
  const endPart = `\r\n--${boundary}--\r\n`;
  const metaBytes = new TextEncoder().encode(metaPart);
  const endBytes = new TextEncoder().encode(endPart);
  const body = new Uint8Array(metaBytes.length + binary.length + endBytes.length);
  body.set(metaBytes, 0);
  body.set(binary, metaBytes.length);
  body.set(endBytes, metaBytes.length + binary.length);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,size',
    {
      method: 'POST',
      headers: authHeaders(accessToken, {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      }),
      body,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as GoogleRestJson;
}

/** List immediate children of a folder (Drive search under parent). Defaults to My Drive root. */
export async function driveListChildren(
  accessToken: string,
  opts: { folderId?: string; pageSize?: number; pageToken?: string } = {},
) {
  const folderId = String(opts.folderId || 'root').trim() || 'root';
  const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false`;
  return driveSearchFiles(accessToken, {
    query: q,
    pageSize: opts.pageSize,
    pageToken: opts.pageToken,
  });
}

export async function driveListComments(
  accessToken: string,
  opts: { fileId: string; pageSize?: number; pageToken?: string },
) {
  const params = new URLSearchParams({
    pageSize: String(Math.min(Math.max(opts.pageSize || 20, 1), 100)),
    fields:
      'nextPageToken,comments(id,content,createdTime,modifiedTime,author,resolved,htmlContent,quotedFileContent)',
  });
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  return googleGetJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/comments?${params.toString()}`,
    accessToken,
  );
}

export async function driveCreateComment(
  accessToken: string,
  opts: { fileId: string; content: string },
) {
  const content = String(opts.content || '').trim();
  if (!content) throw new Error('content is required');
  return googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/comments?fields=id,content,createdTime,author`,
    accessToken,
    'POST',
    { content },
  );
}

export async function driveDeleteComment(
  accessToken: string,
  opts: { fileId: string; commentId: string },
) {
  await googleSendJson(
    `${DRIVE_API}/files/${encodeURIComponent(opts.fileId)}/comments/${encodeURIComponent(opts.commentId)}`,
    accessToken,
    'DELETE',
  );
  return { ok: true, deleted: opts.commentId };
}

/** Lightweight connectivity probe used by /api/integrations/google/probe. */
export async function probeGoogleApis(accessToken: string): Promise<
  Array<{ service: 'gmail' | 'calendar' | 'drive'; ok: boolean; error?: string }>
> {
  const checks: Array<{
    service: 'gmail' | 'calendar' | 'drive';
    run: () => Promise<unknown>;
  }> = [
    { service: 'gmail', run: () => gmailListLabels(accessToken) },
    { service: 'calendar', run: () => calendarListCalendars(accessToken) },
    {
      service: 'drive',
      run: () => driveSearchFiles(accessToken, { pageSize: 1 }),
    },
  ];
  const results = [];
  for (const check of checks) {
    try {
      await check.run();
      results.push({ service: check.service, ok: true });
    } catch (err: unknown) {
      results.push({
        service: check.service,
        ok: false,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    }
  }
  return results;
}
