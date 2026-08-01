/**
 * Dynamic memory-extraction triggers.
 * Prefer explicit cues and short idle windows over a fixed message count.
 */

export const MEMORY_IDLE_MS = 30_000;
export const MEMORY_MAX_USER_TURNS = 4;
export const MEMORY_MAX_CHARS = 6_000;

const MEMORY_CUE_RE =
  /(?:记住|记得|别再|不要再|以后都|以后请|下次不要|我的偏好|我现在改用|忘掉|不要记住|from now on|remember(?:\s+that)?|don't\s+(?:ever\s+)?(?:again|do)|prefer(?:ence)?|forget)/i;

export function looksLikeMemoryCue(text: string): boolean {
  return MEMORY_CUE_RE.test(String(text || '').trim());
}

export function countUserTurns(
  messages: Array<{ role: string; content?: string }>,
): number {
  return messages.filter(
    (m) => m.role === 'user' && String(m.content || '').trim(),
  ).length;
}

export function totalTextChars(
  messages: Array<{ role: string; content?: string }>,
): number {
  return messages.reduce(
    (sum, m) => sum + String(m.content || '').trim().length,
    0,
  );
}

export type MemoryTriggerDecision =
  | { shouldExtract: true; reason: 'cue' | 'idle' | 'turn_limit' | 'size_limit' }
  | { shouldExtract: false; reason: 'empty' | 'waiting' };

export function decideMemoryExtraction(opts: {
  pendingMessages: Array<{ role: string; content?: string }>;
  idleMs: number;
  forceCue?: boolean;
}): MemoryTriggerDecision {
  const pending = opts.pendingMessages.filter((m) =>
    String(m.content || '').trim(),
  );
  if (!pending.length) return { shouldExtract: false, reason: 'empty' };

  if (
    opts.forceCue ||
    pending.some(
      (m) => m.role === 'user' && looksLikeMemoryCue(String(m.content || '')),
    )
  ) {
    return { shouldExtract: true, reason: 'cue' };
  }

  if (countUserTurns(pending) >= MEMORY_MAX_USER_TURNS) {
    return { shouldExtract: true, reason: 'turn_limit' };
  }

  if (totalTextChars(pending) >= MEMORY_MAX_CHARS) {
    return { shouldExtract: true, reason: 'size_limit' };
  }

  if (opts.idleMs >= MEMORY_IDLE_MS) {
    return { shouldExtract: true, reason: 'idle' };
  }

  return { shouldExtract: false, reason: 'waiting' };
}

/** Messages after the last extracted id (exclusive). */
export function messagesAfterCursor<T extends { id: string }>(
  messages: T[],
  cursorId?: string | null,
): T[] {
  if (!cursorId) return messages;
  const idx = messages.findIndex((m) => m.id === cursorId);
  if (idx < 0) return messages;
  return messages.slice(idx + 1);
}
