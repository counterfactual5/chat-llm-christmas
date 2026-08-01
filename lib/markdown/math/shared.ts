/** Internal helpers shared across math markdown modules. */

export const MATH_ENVIRONMENTS = [
  'aligned',
  'align',
  'alignat',
  'gather',
  'gathered',
  'split',
  'multline',
  'equation',
  'eqnarray',
  'cases',
  'array',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
].join('|');

/** Split text into fenced-code vs other segments (protect ``` blocks). */
export function mapOutsideFences(text: string, fn: (segment: string) => string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((segment, idx) => (idx % 2 === 1 || segment.startsWith('```') ? segment : fn(segment)))
    .join('');
}
