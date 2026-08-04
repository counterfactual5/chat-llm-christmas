/**
 * After book_download (or similar), warm the chat-api extract sidecar so
 * follow-up file_read is ready. Extraction runs on chat-api (Node); this only
 * triggers GET /files/:id/extract.
 */

import { fetchUploadTicket } from '@/lib/files/direct-upload';

/** Fire-and-forget: ask chat-api to build/cache the text extract. */
export async function ensureFileExtractSidecar(opts: {
  fileId: string;
  filename?: string;
  url?: string;
}): Promise<{ ok: boolean; chars?: number; error?: string }> {
  const fileId = String(opts.fileId || '').trim();
  if (!fileId) return { ok: false, error: 'missing fileId' };

  try {
    const ticket = await fetchUploadTicket();
    const base = ticket.uploadUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/${encodeURIComponent(fileId)}/extract`, {
      headers: { 'X-Upload-Token': ticket.uploadToken },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        ok: false,
        error: detail.trim().slice(0, 200) || `extract GET HTTP ${res.status}`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as { chars?: number };
    return { ok: true, chars: Number(data.chars) || 0 };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'ensure extract failed',
    };
  }
}
