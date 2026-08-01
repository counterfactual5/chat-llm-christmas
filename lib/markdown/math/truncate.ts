/**
 * Streaming truncation helpers: escape a trailing unclosed $$/$ span so
 * KaTeX never sees a partial expression (which would paint a red error).
 */
import { mapOutsideFences } from './shared';

/**
 * While streaming, escape a trailing unclosed $$ so KaTeX never sees a partial
 * block (which would paint the classic piercing red error).
 */
export function escapeIncompleteBlockMath(text: string): string {
  return mapOutsideFences(text, (segment) => {
    const parts = segment.split('$$');
    if (parts.length % 2 === 1) return segment; // even number of $$ → all closed
    // Last open block still streaming — show source as plain text.
    return `${parts.slice(0, -1).join('$$')}\\$\\$${parts[parts.length - 1]}`;
  });
}

/**
 * Escape a trailing unclosed single-$ inline math (ignore $$ and currency-like).
 */
export function escapeIncompleteInlineMath(text: string): string {
  return mapOutsideFences(text, (segment) => {
    // Work outside already-closed $$ blocks.
    return segment
      .split(/(\$\$[\s\S]*?\$\$)/g)
      .map((chunk) => {
        if (chunk.startsWith('$$')) return chunk;
        let count = 0;
        let lastIdx = -1;
        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] !== '$') continue;
          if (chunk[i + 1] === '$') {
            i += 1;
            continue;
          }
          // Skip escaped \$
          if (i > 0 && chunk[i - 1] === '\\') continue;
          count += 1;
          lastIdx = i;
        }
        if (count % 2 === 0 || lastIdx < 0) return chunk;
        return `${chunk.slice(0, lastIdx)}\\$${chunk.slice(lastIdx + 1)}`;
      })
      .join('');
  });
}
