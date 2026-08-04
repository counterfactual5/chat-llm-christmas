import { eastAsianWidth } from 'get-east-asian-width';

/**
 * Terminal cell columns for one Unicode scalar.
 *
 * Box-drawing is Unicode "ambiguous" but every common mono font (and every
 * model diagram) treats it as 1 cell. Keep ambiguous narrow so ┌─│ stay single
 * width; wide/fullwidth CJK stay 2 — matching East-Asian terminal layout that
 * models pad for. Do NOT use ambiguousAsWide: that would double box-drawing
 * and shred diagrams.
 */
export function eastAsianCharColumns(ch: string): 1 | 2 {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return 1;
  return eastAsianWidth(cp);
}

/** Sum of terminal columns across a line (for alignment checks / tests). */
export function eastAsianLineColumns(line: string): number {
  let n = 0;
  for (const ch of String(line || '')) {
    n += eastAsianCharColumns(ch);
  }
  return n;
}
