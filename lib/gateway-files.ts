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
  let fileId = img.fileId ? String(img.fileId).trim() : '';
  const url = img.url ? String(img.url).trim() : '';

  if (!fileId && url.startsWith('/api/files/')) {
    fileId = decodeURIComponent(url.slice('/api/files/'.length).split(/[?#]/)[0] || '');
  }

  if (fileId) {
    // NewAPI / many OpenAI-compatible gateways resolve Files API ids when
    // placed in image_url.url (vision). Prefer this over type:file for images.
    return {
      type: 'image_url',
      image_url: { url: fileId },
    };
  }

  if (!url || url.startsWith('/api/files/') || (url.startsWith('/') && !url.startsWith('data:'))) {
    return null;
  }

  return {
    type: 'image_url',
    image_url: { url },
  };
}

/** Clear assistant stub so non-vision models still know an image already exists. */
export function generatedImageAssistantSummary(prompts: string[]): string {
  const clean = prompts.map((p) => String(p || '').trim()).filter(Boolean);
  return [
    '【图片已成功生成并展示给用户】',
    'Christmas Chat successfully generated an image; it is already visible in the chat UI.',
    'Do NOT say generation failed. Do NOT claim missing project folders, workspaces, disks, or local tools.',
    'Do NOT substitute web search links or ASCII art for this image unless the user explicitly asks for alternatives.',
    clean.length ? `Image prompt: ${clean.join('; ')}` : 'Image prompt: (see prior user /image command)',
  ].join('\n');
}
