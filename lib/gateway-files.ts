/** Upload / reference helpers for the llm.christmas (NewAPI) Files API. */

export function gatewayBaseURL() {
  return (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(
    /\/$/,
    '',
  );
}

export type GatewayFileRef = {
  id: string;
  filename?: string;
  bytes?: number;
  purpose?: string;
};

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i);
  if (!m?.[2]) return null;
  const mime = m[1] || 'application/octet-stream';
  const binary = atob(m[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

/**
 * Upload bytes to the gateway Files API. Returns a reusable file id.
 * Prefer purpose `vision` for images; fall back to `assistants` if rejected.
 */
export async function uploadGatewayFile(opts: {
  apiKey: string;
  baseURL?: string;
  bytes: Uint8Array;
  filename: string;
  mime?: string;
  purpose?: string;
}): Promise<GatewayFileRef> {
  const baseURL = (opts.baseURL || gatewayBaseURL()).replace(/\/$/, '');
  const purposes = opts.purpose
    ? [opts.purpose]
    : opts.mime?.startsWith('image/')
      ? ['vision', 'assistants']
      : ['assistants', 'vision'];

  let lastError = 'File upload failed';
  for (const purpose of purposes) {
    const form = new FormData();
    // Copy into a plain ArrayBuffer-backed view for Blob compatibility on Edge.
    const copy = new Uint8Array(opts.bytes.byteLength);
    copy.set(opts.bytes);
    const blob = new Blob([copy], {
      type: opts.mime || 'application/octet-stream',
    });
    form.append('file', blob, opts.filename);
    form.append('purpose', purpose);

    const res = await fetch(`${baseURL}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.id) {
      return {
        id: String(data.id),
        filename: data.filename ? String(data.filename) : opts.filename,
        bytes: typeof data.bytes === 'number' ? data.bytes : opts.bytes.byteLength,
        purpose: data.purpose ? String(data.purpose) : purpose,
      };
    }
    lastError =
      data?.error?.message || data?.message || `File upload HTTP ${res.status}`;
  }
  throw new Error(lastError);
}

export async function uploadGatewayDataUrl(opts: {
  apiKey: string;
  baseURL?: string;
  dataUrl: string;
  filename?: string;
}): Promise<GatewayFileRef> {
  const parsed = parseDataUrl(opts.dataUrl);
  if (!parsed) throw new Error('Invalid data URL for file upload');
  const ext = parsed.mime.split('/')[1]?.split('+')[0] || 'bin';
  return uploadGatewayFile({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    bytes: parsed.bytes,
    mime: parsed.mime,
    filename: opts.filename || `upload.${ext}`,
  });
}

export async function uploadGatewayBase64Png(opts: {
  apiKey: string;
  baseURL?: string;
  b64: string;
  filename?: string;
}): Promise<GatewayFileRef> {
  return uploadGatewayDataUrl({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    dataUrl: `data:image/png;base64,${opts.b64}`,
    filename: opts.filename || `image-${Date.now()}.png`,
  });
}

/** Build a Chat Completions content part that references a gateway file or raw URL. */
export function toImageContentPart(img: {
  fileId?: string | null;
  url?: string | null;
}): Record<string, unknown> | null {
  const fileId = img.fileId ? String(img.fileId).trim() : '';
  if (fileId) {
    // NewAPI OpenAI-compatible file block — resolved server-side, no base64 re-send.
    return {
      type: 'file',
      file: { file_id: fileId },
    };
  }
  const url = img.url ? String(img.url).trim() : '';
  if (!url || url.startsWith('/api/files/')) return null;
  return {
    type: 'image_url',
    image_url: { url },
  };
}
