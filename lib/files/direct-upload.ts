/**
 * Browser → chat-api direct upload (bypasses Vercel ~4.5MB body limit).
 * Auth: short-lived upload ticket from /api/files/upload-token (cookie → sk-).
 *
 * Authoritative text extract is produced server-side; the browser never sends
 * a multipart `extract` field. The `extractText` option is kept on the wire
 * shape for compatibility with older callers but is ignored here.
 */

export type DirectUploadTicket = {
  uploadToken: string;
  uploadUrl: string;
  maxBytes: number;
  expiresAt: number;
};

export async function fetchUploadTicket(): Promise<DirectUploadTicket> {
  const res = await fetch('/api/files/upload-token', { method: 'POST' });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    uploadToken?: string;
    uploadUrl?: string;
    maxBytes?: number;
    expiresAt?: number;
  };
  if (!res.ok || !data.uploadToken || !data.uploadUrl) {
    throw new Error(data.error || `Upload token failed (HTTP ${res.status})`);
  }
  return {
    uploadToken: String(data.uploadToken),
    uploadUrl: String(data.uploadUrl),
    maxBytes: Number(data.maxBytes) || 20 * 1024 * 1024,
    expiresAt: Number(data.expiresAt) || 0,
  };
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; filename: string } | null {
  const m = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i);
  if (!m?.[2]) return null;
  const mime = (m[1] || 'application/octet-stream').split(';')[0].trim();
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.split('/')[1]?.split('+')[0] || 'bin';
  return {
    blob: new Blob([bytes], { type: mime }),
    filename: `upload.${ext}`,
  };
}

/**
 * Upload bytes straight to chat-api. Falls back to same-origin /api/files if
 * the ticket endpoint is unavailable (older deploy) so uploads keep working.
 */
export async function uploadAttachmentDirect(opts: {
  blob?: Blob | null;
  dataUrl?: string | null;
  filename: string;
  mime?: string;
  /** @deprecated server is the extract authority; this field is ignored. */
  extractText?: string | null;
}): Promise<{ id: string; filename?: string; bytes?: number }> {
  let blob = opts.blob || null;
  let filename = opts.filename || 'upload.bin';
  if (!blob && opts.dataUrl) {
    const parsed = dataUrlToBlob(opts.dataUrl);
    if (!parsed) throw new Error('Invalid data URL for upload');
    blob = parsed.blob;
    if (!opts.filename) filename = parsed.filename;
  }
  if (!blob) throw new Error('Missing file bytes');

  let ticket: DirectUploadTicket;
  try {
    ticket = await fetchUploadTicket();
  } catch {
    // Older chat-api / deploy without /upload-token → same-origin proxy.
    return uploadViaVercelProxy(opts);
  }

  if (blob.size > ticket.maxBytes) {
    throw new Error(
      `File too large (${(blob.size / (1024 * 1024)).toFixed(1)}MB; max ${(ticket.maxBytes / (1024 * 1024)).toFixed(0)}MB)`,
    );
  }

  const form = new FormData();
  const type = opts.mime || blob.type || 'application/octet-stream';
  form.append('file', blob, filename);
  form.append('purpose', type.startsWith('image/') ? 'vision' : 'assistants');

  const res = await fetch(ticket.uploadUrl, {
    method: 'POST',
    headers: { 'X-Upload-Token': ticket.uploadToken },
    body: form,
  });
  const rawText = await res.text();
  let data: any = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { error: rawText.slice(0, 200) };
  }
  if (res.ok && data?.id) {
    return {
      id: String(data.id),
      filename: data.filename ? String(data.filename) : filename,
      bytes: typeof data.bytes === 'number' ? data.bytes : blob.size,
    };
  }
  throw new Error(
    typeof data?.error === 'string'
      ? data.error
      : typeof data?.message === 'string'
        ? data.message
        : `Upload failed (HTTP ${res.status})`,
  );
}

async function uploadViaVercelProxy(opts: {
  blob?: Blob | null;
  dataUrl?: string | null;
  filename: string;
  /** @deprecated server is the extract authority; this field is ignored. */
  extractText?: string | null;
}): Promise<{ id: string; filename?: string; bytes?: number }> {
  let res: Response;
  if (opts.blob) {
    const form = new FormData();
    form.append('file', opts.blob, opts.filename);
    res = await fetch('/api/files', { method: 'POST', body: form });
  } else {
    res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: opts.dataUrl,
        filename: opts.filename,
      }),
    });
  }
  const rawText = await res.text();
  let data: any = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { error: rawText.slice(0, 200) };
  }
  if (res.ok && data?.id) {
    return {
      id: String(data.id),
      filename: data.filename ? String(data.filename) : opts.filename,
      bytes: typeof data.bytes === 'number' ? data.bytes : undefined,
    };
  }
  const payloadTooLarge =
    res.status === 413 ||
    /FUNCTION_PAYLOAD_TOO_LARGE|payload too large|request entity too large/i.test(
      `${data?.error || ''} ${rawText}`,
    );
  throw new Error(
    payloadTooLarge
      ? 'File too large for upload proxy (enable direct upload or use a smaller file)'
      : typeof data?.error === 'string'
        ? data.error
        : `Upload failed (HTTP ${res.status})`,
  );
}
