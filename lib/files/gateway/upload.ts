/** Upload helpers for the llm.christmas (NewAPI) Files API. */

import { filesGatewayBaseURL, resolveUploadModel } from './base';
import { parseDataUrl } from './data-url';
import type { GatewayFileRef } from './types';

/**
 * Upload bytes to the gateway Files API. Returns a reusable file id.
 * Prefer purpose `vision` for images; fall back to `assistants` if rejected.
 *
 * NewAPI's distributor skips reading `model` from multipart bodies on `/v1/files`
 * (it only parses JSON / non-multipart). The empty model then fails with
 * "Model name not specified…". Pass `model` as a query param (and still in the
 * form for forks that do read PostForm).
 */
export async function uploadGatewayFile(opts: {
  apiKey: string;
  baseURL?: string;
  bytes: Uint8Array;
  filename: string;
  mime?: string;
  purpose?: string;
  /** Gateway routing model — required by NewAPI; defaults from env or gpt-4o. */
  model?: string;
  /** Optional client-extracted text sidecar for PDF/DOCX (chat-api). */
  extractText?: string;
}): Promise<GatewayFileRef> {
  const baseURL = (opts.baseURL || filesGatewayBaseURL()).replace(/\/$/, '');
  const model = resolveUploadModel(opts.model);
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
    form.append('model', model);
    const extract = String(opts.extractText || '').trim();
    if (extract && !opts.mime?.startsWith('image/')) {
      form.append('extract', extract);
    }

    // Query param is what NewAPI-compatible distributors can see when the body
    // is multipart (form fields are ignored for channel selection on /files).
    const url = `${baseURL}/files?model=${encodeURIComponent(model)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        // Some forks also accept an explicit routing header.
        'X-Model': model,
      },
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
  model?: string;
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
    model: opts.model,
  });
}

export async function uploadGatewayBase64Png(opts: {
  apiKey: string;
  baseURL?: string;
  b64: string;
  filename?: string;
  model?: string;
}): Promise<GatewayFileRef> {
  return uploadGatewayDataUrl({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    dataUrl: `data:image/png;base64,${opts.b64}`,
    filename: opts.filename || `image-${Date.now()}.png`,
    model: opts.model,
  });
}
