/**
 * Pure detection helpers: is display math open/closed, and does a trailing
 * unclosed $$ look like cut-off LaTeX (vs. prose mentioning "$$").
 */

/**
 * Count $$ delimiters outside fenced/inline code so prose like
 * “同一个 $$ 块” does not look like an unclosed math block.
 */
export function countDisplayMathDelimiters(text: string): number {
  let t = String(text || '');
  t = t.replace(/```[\s\S]*?(?:```|$)/g, '');
  t = t.replace(/`[^`\n]*`/g, '');
  return (t.match(/\$\$/g) || []).length;
}

export function hasUnclosedDisplayMath(text: string): boolean {
  return countDisplayMathDelimiters(text) % 2 === 1;
}

/** True when the tail after the last $$ looks like cut-off LaTeX, not prose. */
export function looksLikeTruncatedMath(text: string): boolean {
  if (!hasUnclosedDisplayMath(text)) return false;
  // Work on code-stripped text for the tail check too.
  let t = String(text || '');
  t = t.replace(/```[\s\S]*?(?:```|$)/g, '');
  t = t.replace(/`[^`\n]*`/g, '');
  const idx = t.lastIndexOf('$$');
  if (idx < 0) return false;
  const after = t.slice(idx + 2);
  if (!after.trim()) return true;
  if (/\\[a-zA-Z]+\s*$/.test(after.trim())) return true;
  if (/[{[\\,]\s*$/.test(after)) return true;
  if (after.trim().length < 48 && !/[.!?。！？…]/.test(after)) return true;
  // Prose after a lone $$ mention (e.g. “$$ 块里用 \quad …吗？”) — not truncated.
  if (/[.!?。！？…]\s*$/.test(after.trim())) return false;
  return /\\begin\{|\\frac|\\sum|\\int|\\left|\\right/.test(after);
}
