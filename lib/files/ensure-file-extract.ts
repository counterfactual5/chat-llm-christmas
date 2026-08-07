/**
 * After book_download (or similar), warm the chat-api extract sidecar so
 * follow-up file_read is ready. Extraction runs on chat-api (Node); this only
 * triggers GET /files/:id/extract.
 *
 * Preview / attach prewarm can poll via `waitForFileExtractSidecar` until
 * `!partial` and (non-empty text or OCR-ready meta), else timeout / abort /
 * EXTRACT_EMPTY. Concurrent waiters for the same fileId share one poller.
 * Does not use SSE.
 */

import { fetchUploadTicket } from '@/lib/files/direct-upload';

export type FileExtractSidecarResult = {
  ok: boolean;
  text?: string;
  chars?: number;
  partial?: boolean;
  needsOcr?: boolean;
  pagesNeedingOcr?: number[];
  error?: string;
  code?: string;
};

export type ExtractSidecarJson = {
  text?: string;
  chars?: number;
  partial?: boolean;
  needs_ocr?: boolean;
  pages_needing_ocr?: number[];
  /** EPUB image-page indexes (same OCR-ready signal as file_read). */
  epub_image_pages?: number[];
  /** PPTX image-slide indexes (same OCR-ready signal as file_read). */
  pptx_image_slides?: number[];
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

type SharedWaitEntry = {
  promise: Promise<FileExtractSidecarResult>;
  controller: AbortController;
  refs: number;
};

const sharedWaits = new Map<string, SharedWaitEntry>();

/**
 * Prefer pages_needing_ocr, then epub_image_pages, then pptx_image_slides —
 * mirrors `file_read` listedNeed so preview/prewarm and the tool agree.
 */
export function listOcrPagesFromExtract(data: ExtractSidecarJson): number[] {
  if (Array.isArray(data.pages_needing_ocr) && data.pages_needing_ocr.length > 0) {
    return data.pages_needing_ocr;
  }
  if (Array.isArray(data.epub_image_pages) && data.epub_image_pages.length > 0) {
    return data.epub_image_pages;
  }
  if (Array.isArray(data.pptx_image_slides) && data.pptx_image_slides.length > 0) {
    return data.pptx_image_slides;
  }
  return [];
}

/** True when extract is finished and has usable text or OCR-ready meta. */
export function isFileExtractSidecarReady(data: ExtractSidecarJson): boolean {
  if (Boolean(data.partial)) return false;
  const text = String(data.text || '');
  if (text.trim()) return true;
  if (Boolean(data.needs_ocr)) return true;
  return listOcrPagesFromExtract(data).length > 0;
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

/** Keep polling for transient / in-progress failures; stop on permanent codes. */
function isRetryableExtractError(code: string | undefined): boolean {
  if (!code) return true; // network / unknown — retry until timeout
  if (code === 'ABORTED') return false;
  if (code === 'FILE_NOT_FOUND' || code === 'HTTP_404') return false;
  if (code === 'EXTRACT_FAILED') return false;
  if (code === 'HTTP_401' || code === 'HTTP_403' || code === 'UNAUTHORIZED') {
    return false;
  }
  if (code === 'HTTP_408' || code === 'HTTP_429') return true;
  // Other 4xx (e.g. 400/422) are usually permanent for this fileId.
  if (/^HTTP_4\d\d$/.test(code)) return false;
  return true;
}

/** Combine caller + deadline signals (AbortSignal.any when available). */
export function combineAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  const anyFn = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === 'function') {
    return anyFn.call(AbortSignal, active);
  }
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort();
    for (const s of active) s.removeEventListener('abort', onAbort);
  };
  for (const s of active) {
    if (s.aborted) {
      controller.abort();
      return controller.signal;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

async function getExtractSidecar(
  fileId: string,
  signal?: AbortSignal,
): Promise<ExtractFetchOk | ExtractFetchErr> {
  try {
    const ticket = await fetchUploadTicket(signal);
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
    const pagesNeedingOcr = listOcrPagesFromExtract(data);
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
 * or OCR-ready meta), timeout, or abort. Bounds in-flight I/O with a deadline
 * AbortSignal so hung ticket/GET cannot outlive timeoutMs.
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
  const deadlineSignal =
    typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  const signal = combineAbortSignals(opts.signal, deadlineSignal);
  const started = Date.now();

  while (true) {
    if (signal?.aborted || opts.signal?.aborted) {
      const timedOut = Boolean(deadlineSignal?.aborted) && !opts.signal?.aborted;
      return timedOut
        ? { ok: false, error: 'Timed out waiting for extract', code: 'TIMEOUT' }
        : { ok: false, error: 'Aborted', code: 'ABORTED' };
    }

    const result = await getExtractSidecar(fileId, signal);
    if (!result.ok && result.code === 'ABORTED') {
      const timedOut = Boolean(deadlineSignal?.aborted) && !opts.signal?.aborted;
      return timedOut
        ? { ok: false, error: 'Timed out waiting for extract', code: 'TIMEOUT' }
        : { ok: false, error: 'Aborted', code: 'ABORTED' };
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
          needsOcr: result.needsOcr,
          pagesNeedingOcr: result.pagesNeedingOcr,
        };
      }
      if (!result.partial) {
        return {
          ok: false,
          text: result.text,
          chars: result.chars,
          partial: false,
          needsOcr: result.needsOcr,
          pagesNeedingOcr: result.pagesNeedingOcr,
          error: 'Extract finished with no readable text',
          code: 'EXTRACT_EMPTY',
        };
      }
    } else if (
      result.code === 'FILE_NOT_FOUND' ||
      result.code === 'HTTP_404' ||
      !isRetryableExtractError(result.code)
    ) {
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
        const timedOut = Boolean(deadlineSignal?.aborted) && !opts.signal?.aborted;
        return timedOut
          ? { ok: false, error: 'Timed out waiting for extract', code: 'TIMEOUT' }
          : { ok: false, error: 'Aborted', code: 'ABORTED' };
      }
      throw cause;
    }
  }
}

/**
 * Shared wait per fileId so attach prewarm and preview do not double-poll.
 * Caller `signal` only releases this caller's ref; the underlying poller aborts
 * when the last ref is released (or the wait settles).
 */
export async function waitForSharedFileExtractSidecar(opts: {
  fileId: string;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<FileExtractSidecarResult> {
  const fileId = String(opts.fileId || '').trim();
  if (!fileId) return { ok: false, error: 'missing fileId', code: 'MISSING_FILE_ID' };

  let entry = sharedWaits.get(fileId);
  if (!entry) {
    const controller = new AbortController();
    const promise = waitForFileExtractSidecar({
      fileId,
      intervalMs: opts.intervalMs,
      timeoutMs: opts.timeoutMs,
      signal: controller.signal,
    }).finally(() => {
      const current = sharedWaits.get(fileId);
      if (current?.promise === promise) sharedWaits.delete(fileId);
    });
    entry = { promise, controller, refs: 0 };
    sharedWaits.set(fileId, entry);
  }

  entry.refs += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const current = sharedWaits.get(fileId);
    if (!current || current !== entry) return;
    current.refs -= 1;
    if (current.refs <= 0) {
      current.controller.abort();
      sharedWaits.delete(fileId);
    }
  };

  if (opts.signal?.aborted) {
    release();
    return { ok: false, error: 'Aborted', code: 'ABORTED' };
  }

  try {
    if (!opts.signal) {
      return await entry.promise;
    }

    // Return ABORTED for this caller when its signal fires, without aborting
    // the shared poller while other refs remain.
    return await new Promise<FileExtractSidecarResult>((resolve) => {
      let settled = false;
      const finish = (value: FileExtractSidecarResult) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = () =>
        finish({ ok: false, error: 'Aborted', code: 'ABORTED' });
      opts.signal!.addEventListener('abort', onAbort, { once: true });
      void entry!.promise.then((result) => {
        if (opts.signal?.aborted) {
          finish({ ok: false, error: 'Aborted', code: 'ABORTED' });
          return;
        }
        finish(result);
      });
    });
  } finally {
    release();
  }
}

/** Test-only: clear shared wait map between cases. */
export function resetSharedFileExtractWaitsForTests(): void {
  for (const entry of sharedWaits.values()) {
    entry.controller.abort();
  }
  sharedWaits.clear();
}
