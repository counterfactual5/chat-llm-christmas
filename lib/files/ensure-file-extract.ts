/**
 * After book_download (or similar), extract PDF/EPUB text in the browser and
 * PUT the sidecar so later file_read rounds are cheap.
 */

import { fetchFileContentForPreview } from '@/lib/files/direct-content';
import { fetchUploadTicket } from '@/lib/files/direct-upload';
import {
  extractEpubTextFromBytes,
  extractPdfTextFromBytes,
} from '@/lib/files/ingest/extractors';

function looksPdf(filename: string, mime: string, buf: Uint8Array): boolean {
  if (/\.pdf$/i.test(filename) || mime === 'application/pdf') return true;
  return (
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  );
}

function looksEpub(filename: string, mime: string): boolean {
  return /\.epub$/i.test(filename) || mime === 'application/epub+zip';
}

/** Fire-and-forget: build + store extract sidecar when missing. */
export async function ensureFileExtractSidecar(opts: {
  fileId: string;
  filename?: string;
  url?: string;
}): Promise<{ ok: boolean; chars?: number; error?: string }> {
  const fileId = String(opts.fileId || '').trim();
  if (!fileId) return { ok: false, error: 'missing fileId' };
  const filename = String(opts.filename || fileId);
  const url = String(opts.url || `/api/files/${encodeURIComponent(fileId)}`).trim();

  try {
    const ticket = await fetchUploadTicket();
    const base = ticket.uploadUrl.replace(/\/$/, '');
    const existing = await fetch(`${base}/${encodeURIComponent(fileId)}/extract`, {
      headers: { 'X-Upload-Token': ticket.uploadToken },
    });
    if (existing.ok) {
      const data = (await existing.json().catch(() => ({}))) as { chars?: number };
      if (Number(data.chars) > 0) return { ok: true, chars: Number(data.chars) };
    }

    const { buf, contentType } = await fetchFileContentForPreview(url);
    const bytes = new Uint8Array(buf);
    const mime = (contentType || '').split(';')[0].trim().toLowerCase();

    let text = '';
    if (looksPdf(filename, mime, bytes)) {
      text = await extractPdfTextFromBytes(bytes);
    } else if (looksEpub(filename, mime)) {
      text = await extractEpubTextFromBytes(bytes);
    } else if (/^text\//i.test(mime) || /\.(txt|md|csv)$/i.test(filename)) {
      text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } else {
      return { ok: false, error: `unsupported extract type: ${mime || filename}` };
    }

    if (!text.trim()) return { ok: false, error: 'empty extract' };

    const put = await fetch(`${base}/${encodeURIComponent(fileId)}/extract`, {
      method: 'PUT',
      headers: {
        'X-Upload-Token': ticket.uploadToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!put.ok) {
      const detail = await put.text().catch(() => '');
      return {
        ok: false,
        error: detail.trim().slice(0, 200) || `extract PUT HTTP ${put.status}`,
      };
    }
    return { ok: true, chars: text.length };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'ensure extract failed',
    };
  }
}
