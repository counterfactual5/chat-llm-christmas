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

async function fetchViaSameOriginProxy(url: string): Promise<FetchedFileContent> {
  const res = await fetch(url, { credentials: 'same-origin' });
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
  const buf = await res.arrayBuffer();
  return { buf, contentType, direct: false };
}

/**
 * Prefer browser → chat-api for `/api/files/<id>` URLs. Falls back to the
 * same-origin Vercel proxy when the ticket endpoint is unavailable.
 */
export async function fetchFileContentForPreview(url: string): Promise<FetchedFileContent> {
  const href = String(url || '').trim();
  if (!href) throw new Error('Missing file URL');

  const fileId = fileIdFromPreviewUrl(href);
  if (!fileId) {
    return fetchViaSameOriginProxy(href);
  }

  try {
    const ticket = await fetchUploadTicket();
    const base = ticket.uploadUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/${encodeURIComponent(fileId)}/content`, {
      headers: { 'X-Upload-Token': ticket.uploadToken },
    });
    if (!res.ok) {
      // Older chat-api without token-auth on GET content → proxy path.
      return fetchViaSameOriginProxy(href);
    }
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
    const buf = await res.arrayBuffer();
    return { buf, contentType, direct: true };
  } catch {
    return fetchViaSameOriginProxy(href);
  }
}
