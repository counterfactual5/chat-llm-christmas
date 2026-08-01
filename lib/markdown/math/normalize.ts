/**
 * Structural normalization for math markdown: LaTeX delimiter conversion and
 * blockquote-wrapped display math lifted so remark-math can parse it.
 */
import { MATH_ENVIRONMENTS } from './shared';

/** Convert \[...\], \(...\), and bare \begin{…} into $ / $$ delimiters. */
export function normalizeMathDelimiters(content: string): string {
  const fences: string[] = [];
  let working = content.replace(/```[\s\S]*?(?:```|$)/g, (block) => {
    fences.push(block);
    return `\u0000F${fences.length - 1}\u0000`;
  });

  working = working
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression) => `$${expression.trim()}$`);

  const envPattern = new RegExp(
    `\\\\begin\\{(${MATH_ENVIRONMENTS})\\*?\\}[\\s\\S]*?\\\\end\\{\\1\\*?\\}`,
    'g',
  );
  working = working
    .split(/(\$\$[\s\S]*?\$\$)/g)
    .map((segment) =>
      segment.startsWith('$$')
        ? segment
        : segment.replace(envPattern, (match) => `\n$$\n${match}\n$$\n`),
    )
    .join('');

  return working.replace(/\u0000F(\d+)\u0000/g, (_, index) => fences[Number(index)]);
}

/**
 * Contiguous `> …` runs whose body is only a $$…$$ (or $…$) math block
 * are lifted out of the blockquote so KaTeX can render them.
 */
export function liftQuotedMathBlocks(content: string): string {
  const lines = String(content || '').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith('>')) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const quoteLines: string[] = [];
    while (i < lines.length && lines[i].startsWith('>')) {
      quoteLines.push(lines[i]);
      i += 1;
    }

    const inner = quoteLines
      .map((line) => (line.startsWith('> ') ? line.slice(2) : line.slice(1)))
      .join('\n')
      .trim();

    if (/^\$\$[\s\S]*\$\$$/.test(inner) || /^\$[^$\n]+\$/.test(inner)) {
      out.push(inner);
    } else {
      out.push(...quoteLines);
    }
  }

  return out.join('\n');
}
