/**
 * Token estimate helpers for UI and compact decisions.
 */

/** Rough token estimate used for UI + compact decisions. */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  // Mixed CJK / Latin heuristic: ~2 chars/token for dense CJK, ~4 for Latin.
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).join('').length;
  const rest = Math.max(0, text.length - cjk);
  return Math.ceil(cjk / 2 + rest / 4);
}

/** Compact display for model menus: 1000000 → "1M", 200000 → "200k". */
export function formatContextWindow(tokens: number | null | undefined): string {
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return '?';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(0)}k`;
  }
  return String(tokens);
}
