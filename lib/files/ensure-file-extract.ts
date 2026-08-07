/**
 * After book_download (or similar), warm the chat-api extract sidecar so
 * follow-up file_read is ready. Extraction runs on chat-api (Node); this only
 * triggers GET /files/:id/extract.
 *
 * Preview / attach prewarm can poll via `waitForFileExtractSidecar` until
 * `partial === false` (or timeout / abort). Does not use SSE.
 */

import { fetchUploadTicket } from '@/lib/files/direct-upload';

export type FileExtractSidecarResult = {
  ok: boolean;
  text?: string;
  chars?: number;
  partial?: boolean;
  error?: string;
  code?: string;
};

export type ExtractSidecarJson = {
  text?: string;
  chars?: number;
  partial?: boolean;
  needs_ocr?: boolean;
  pages_needing_ocr?: number[];
  code?: string;
  message?: string;
  error?: string;
};

type ExtractFetchOk = {
  ok: true;
  text: string;
  chars: number;
  partial: boolean;
  needsOcr: boolean;
  pagesNeedingOcr: number[];
};

type ExtractFetchErr = {
  ok: false;
  error: string;
  code?: string;
};

const DEFAULT_INTERVAL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 60_000;

/** True when extract is finished and has usable text or OCR-ready meta. */
export function isFileExtractSidecarReady(data: ExtractSidecarJson): boolean {
  if (Boolean(data.partial)) return false;
  const text = String(data.text || '');
  if (text.trim()) return true;
  if (Boolean(data.needs_ocr)) return true;
  if (Array.isArray(data.pages_needing_ocr) && data.pages_needing_ocr.length > 0) {
    return true;
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  return String((cause as { name?: string }).name || '') === 'AbortError';
}

async function getExtractSidecar(
  fileId: string,
  signal?: AbortSignal,
): Promise<ExtractFetchOk | ExtractFetchErr> {
  try {
    const ticket = await fetchUploadTicket();
    if (signal?.aborted) {
      return { ok: false, error: 'Aborted', code: 'ABORTED' };
    }
    const base = ticket.uploadUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/${encodeURIComponent(fileId)}/extract`, {
      headers: { 'X-Upload-Token': ticket.uploadToken },
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let code = `HTTP_${res.status}`;
      let message = detail.trim().slice(0, 200) || `extract GET HTTP ${res.status}`;
      try {
        const body = JSON.parse(detail) as ExtractSidecarJson;
        if (body.code) code = String(body.code);
        message = String(body.message || body.error || message);
      } catch {
        /* plain text body */
      }
      return { ok: false, error: message, code };
    }
    const data = (await res.json().catch(() => ({}))) as ExtractSidecarJson;
    const text = String(data.text || '');
    const chars = Number(data.chars);
    const pagesNeedingOcr = Array.isArray(data.pages_needing_ocr)
      ? data.pages_needing_ocr
      : [];
    return {
      ok: true,
      text,
      chars: Number.isFinite(chars) && chars > 0 ? chars : text.length,
      partial: Boolean(data.partial),
      needsOcr: Boolean(data.needs_ocr) || pagesNeedingOcr.length > 0,
      pagesNeedingOcr,
    };
  } catch (cause) {
    if (isAbortError(cause) || signal?.aborted) {
      return { ok: false, error: 'Aborted', code: 'ABORTED' };
    }
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'ensure extract failed',
    };
  }
}

/** Fire-and-forget: ask chat-api to build/cache the text extract (single GET). */
export async function ensureFileExtractSidecar(opts: {
  fileId: string;
  filename?: string;
  url?: string;
}): Promise<{ ok: boolean; chars?: number; error?: string }> {
  const fileId = String(opts.fileId || '').trim();
  if (!fileId) return { ok: false, error: 'missing fileId' };

  const result = await getExtractSidecar(fileId);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, chars: result.chars || 0 };
}

/**
 * Poll GET /files/:id/extract until ready (`partial === false` + usable text
 * or OCR-ready meta), timeout, or abort.
 */
export async function waitForFileExtractSidecar(opts: {
  fileId: string;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<FileExtractSidecarResult> {
  const fileId = String(opts.fileId || '').trim();
  if (!fileId) return { ok: false, error: 'missing fileId', code: 'MISSING_FILE_ID' };

  const intervalMs = Math.max(50, Number(opts.intervalMs) || DEFAULT_INTERVAL_MS);
  const timeoutMs = Math.max(intervalMs, Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const signal = opts.signal;
  const started = Date.now();

  while (true) {
    if (signal?.aborted) {
      return { ok: false, error: 'Aborted', code: 'ABORTED' };
    }

    const result = await getExtractSidecar(fileId, signal);
    if (!result.ok && result.code === 'ABORTED') {
      return { ok: false, error: 'Aborted', code: 'ABORTED' };
    }

    if (result.ok) {
      const ready = isFileExtractSidecarReady({
        text: result.text,
        partial: result.partial,
        needs_ocr: result.needsOcr,
        pages_needing_ocr: result.pagesNeedingOcr,
      });
      if (ready) {
        return {
          ok: true,
          text: result.text,
          chars: result.chars,
          partial: false,
        };
      }
      if (!result.partial) {
        return {
          ok: false,
          text: result.text,
          chars: result.chars,
          partial: false,
          error: 'Extract finished with no readable text',
          code: 'EXTRACT_EMPTY',
        };
      }
    } else if (result.code === 'FILE_NOT_FOUND' || result.code === 'HTTP_404') {
      return { ok: false, error: result.error, code: result.code };
    }

    const elapsed = Date.now() - started;
    if (elapsed + intervalMs > timeoutMs) {
      return {
        ok: false,
        partial: result.ok ? result.partial : undefined,
        error: result.ok
          ? 'Timed out waiting for extract'
          : result.error || 'Timed out waiting for extract',
        code: 'TIMEOUT',
      };
    }

    try {
      await sleep(intervalMs, signal);
    } catch (cause) {
      if (isAbortError(cause) || signal?.aborted) {
        return { ok: false, error: 'Aborted', code: 'ABORTED' };
      }
      throw cause;
    }
  }
}
