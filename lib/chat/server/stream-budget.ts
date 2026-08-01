/**
 * Streaming timeout budget helpers for the chat API.
 * Pure time math — no network I/O.
 */

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
