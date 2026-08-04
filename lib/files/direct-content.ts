/**
 * Browser → chat-api direct file content (bypasses Vercel proxy hop).
 * Same short-lived upload ticket used for direct uploads; GET /files/:id/content
 * accepts X-Upload-Token so preview bytes come straight from disk storage.
 */

import { fetchUploadTicket } from '@/lib/files/direct-upload';

export type FetchedFileContent = {
  buf: ArrayBuffer;
  contentType: string;
  /** true when bytes came from chat-api without going through /api/files proxy. */
  direct: boolean;
};

export type FetchFileProgress = {
  loaded: number;
  total: number;
};

type FetchOpts = {
  onProgress?: (progress: FetchFileProgress) => void;
  signal?: AbortSignal;
};

/** Keep a few recent previews in memory so reopening an EPUB/PDF is instant. */
const PREVIEW_CACHE_MAX = 6;
const previewCache = new Map<
  string,
  { buf: ArrayBuffer; contentType: string; direct: boolean }
>();

function cachePut(
  fileId: string,
  entry: { buf: ArrayBuffer; contentType: string; direct: boolean },
) {
  if (!fileId) return;
  if (previewCache.has(fileId)) previewCache.delete(fileId);
  previewCache.set(fileId, entry);
  while (previewCache.size > PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest == null) break;
    previewCache.delete(oldest);
  }
}

export function fileIdFromPreviewUrl(url: string): string {
  const raw = String(url || '').trim();
  const m = raw.match(/^\/api\/files\/([^/?#]+)/i);
  if (!m?.[1]) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

async function readResponseBuffer(
  res: Response,
  onProgress?: (progress: FetchFileProgress) => void,
): Promise<ArrayBuffer> {
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = await res.arrayBuffer();
    onProgress?.({ loaded: buf.byteLength, total: buf.byteLength });
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.byteLength) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

async function fetchViaSameOriginProxy(
  url: string,
  opts?: FetchOpts,
): Promise<FetchedFileContent> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    signal: opts?.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const hint = detail.trim().slice(0, 120);
    throw new Error(
      hint
        ? `Failed to load file (${res.status}): ${hint}`
        : `Failed to load file (${res.status})`,
    );
  }
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
  const buf = await readResponseBuffer(res, opts?.onProgress);
  return { buf, contentType, direct: false };
}

/**
 * Prefer browser → chat-api for `/api/files/<id>` URLs. Falls back to the
 * same-origin Vercel proxy when the ticket endpoint is unavailable.
 */
export async function fetchFileContentForPreview(
  url: string,
  opts?: FetchOpts,
): Promise<FetchedFileContent> {
  const href = String(url || '').trim();
  if (!href) throw new Error('Missing file URL');

  const fileId = fileIdFromPreviewUrl(href);
  if (fileId) {
    const hit = previewCache.get(fileId);
    if (hit) {
      opts?.onProgress?.({
        loaded: hit.buf.byteLength,
        total: hit.buf.byteLength,
      });
      return { ...hit };
    }
  }

  if (!fileId) {
    const fetched = await fetchViaSameOriginProxy(href, opts);
    return fetched;
  }

  try {
    const ticket = await fetchUploadTicket();
    const base = ticket.uploadUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/${encodeURIComponent(fileId)}/content`, {
      headers: { 'X-Upload-Token': ticket.uploadToken },
      signal: opts?.signal,
    });
    if (!res.ok) {
      // Older chat-api without token-auth on GET content → proxy path.
      const fetched = await fetchViaSameOriginProxy(href, opts);
      cachePut(fileId, fetched);
      return fetched;
    }
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
    const buf = await readResponseBuffer(res, opts?.onProgress);
    const fetched = { buf, contentType, direct: true as const };
    cachePut(fileId, fetched);
    return fetched;
  } catch (err) {
    if (opts?.signal?.aborted) throw err;
    const fetched = await fetchViaSameOriginProxy(href, opts);
    cachePut(fileId, fetched);
    return fetched;
  }
}
