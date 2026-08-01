/**
 * Streaming timeout budget helpers for the chat API.
 * Pure time math, plus a generator wrapper that applies it — no network I/O
 * of its own (the wrapped iterable does the actual fetching).
 */

import { withTimeout } from '@/lib/chat/server/upstream';

export function streamWaitBudget(opts: {
  startedAt: number;
  lastChunkAt: number;
  idleMs: number;
  maxTotalMs: number;
}): number {
  const idleRemaining = opts.idleMs - (Date.now() - opts.lastChunkAt);
  const totalRemaining = opts.maxTotalMs - (Date.now() - opts.startedAt);
  return Math.min(idleRemaining, totalRemaining);
}

export function streamTimeoutError(
  label: string,
  idleMs: number,
  maxTotalMs: number,
  startedAt: number,
  lastChunkAt: number,
): Error {
  const stalledFor = Date.now() - lastChunkAt;
  const totalFor = Date.now() - startedAt;
  if (totalFor >= maxTotalMs) {
    return new Error(`${label} exceeded ${Math.round(maxTotalMs / 1000)}s total budget`);
  }
  return new Error(`${label} stalled for ${Math.round(stalledFor / 1000)}s (no upstream chunks)`);
}

/**
 * Wrap any upstream async iterable with idle + total-wall-clock budgets,
 * throwing `streamTimeoutError` when either is exhausted. Shared by the
 * tool-calling round loop and the final completion pass so both time out
 * the same way instead of duplicating the bookkeeping.
 */
export async function* boundedAsyncIterator<T>(
  raw: AsyncIterable<T>,
  opts: { idleMs: number; maxTotalMs: number; label: string },
): AsyncGenerator<T> {
  const iter = raw[Symbol.asyncIterator]();
  const startedAt = Date.now();
  let lastChunkAt = startedAt;
  while (true) {
    const remaining = streamWaitBudget({
      startedAt,
      lastChunkAt,
      idleMs: opts.idleMs,
      maxTotalMs: opts.maxTotalMs,
    });
    if (remaining <= 0) {
      throw streamTimeoutError(opts.label, opts.idleMs, opts.maxTotalMs, startedAt, lastChunkAt);
    }
    let next: IteratorResult<T>;
    try {
      next = await withTimeout(iter.next(), remaining, `${opts.label} chunk`);
    } catch (chunkErr: unknown) {
      const msg = chunkErr instanceof Error ? chunkErr.message : String(chunkErr || 'failed');
      if (/timed out/i.test(msg)) {
        throw streamTimeoutError(opts.label, opts.idleMs, opts.maxTotalMs, startedAt, lastChunkAt);
      }
      throw chunkErr;
    }
    if (next.done) break;
    lastChunkAt = Date.now();
    yield next.value;
  }
}
