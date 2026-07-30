/**
 * Math-aware markdown helpers for chat streaming + quotes.
 * Incomplete $$ / $ during stream → plain text (no KaTeX red errors).
 * Blockquote-wrapped display math → lifted so remark-math can parse it.
 */

const MATH_ENVIRONMENTS = [
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

/** Split text into fenced-code vs other segments (protect ``` blocks). */
function mapOutsideFences(text: string, fn: (segment: string) => string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((segment, idx) => (idx % 2 === 1 || segment.startsWith('```') ? segment : fn(segment)))
    .join('');
}

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

/**
 * CommonMark won't treat `**“…”**` as bold when CJK quotation marks sit flush
 * against the markers. Move the quotes outside so emphasis still parses:
 * `**“text”**` → `“**text**”`.
 */
export function fixFlankingEmphasis(content: string): string {
  return String(content || '').replace(
    /\*\*([“「『"'])([\s\S]*?)([”」』"'])\*\*/g,
    '$1**$2**$3',
  );
}

export function prepareChatMarkdown(content: string, opts?: { streaming?: boolean }): string {
  let out = normalizeMathDelimiters(String(content || ''));
  out = liftQuotedMathBlocks(out);
  out = fixFlankingEmphasis(out);

  // Unclosed $$ must be escaped for display — otherwise remark-math swallows the
  // rest of the message into one giant math/“quote-looking” block (even after
  // the stream has ended and Continue is showing “Unclosed math block”).
  const oddBlockMath = hasUnclosedDisplayMath(out);
  if (opts?.streaming || oddBlockMath) {
    out = escapeIncompleteBlockMath(out);
  }
  if (opts?.streaming) {
    out = escapeIncompleteInlineMath(out);
  }
  return out;
}

/**
 * Shrink quote previews: turn lone $$…$$ formulas into inline $…$
 * (keeps \begin{…} display blocks). Cuts KaTeX display margins in quote chips.
 */
export function compactQuoteMath(content: string): string {
  return String(content || '').replace(/\$\$([\s\S]*?)\$\$/g, (full, expr) => {
    const inner = String(expr).trim();
    if (!inner) return full;
    if (/\\begin\{/.test(inner)) return `\n$$\n${inner}\n$$\n`;
    return `$${inner.replace(/\s*\n\s*/g, ' ')}$`;
  });
}

/** Recover TeX source from a KaTeX DOM node (annotation / MathML). */
export function texFromKatexElement(el: Element): string | null {
  const ann =
    el.querySelector('annotation[encoding="application/x-tex"]') ||
    el.querySelector('annotation');
  const tex = ann?.textContent?.trim();
  return tex || null;
}

function closestKatex(node: Node | null): Element | null {
  if (!node) return null;
  const el =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest('.katex') ?? null;
}

function isDisplayKatex(el: Element): boolean {
  return Boolean(el.closest('.katex-display'));
}

/**
 * Prefer KaTeX TeX annotations over glyph soup when the user selects a formula.
 * Falls back to plain selection text.
 */
export function markdownFromDomSelection(sel: Selection | null): string {
  if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
  const plain = sel.toString().replace(/\u00a0/g, ' ').trim();

  const startKatex = closestKatex(sel.anchorNode);
  const endKatex = closestKatex(sel.focusNode);
  if (startKatex && startKatex === endKatex) {
    const tex = texFromKatexElement(startKatex);
    if (tex) {
      return isDisplayKatex(startKatex) ? `$$\n${tex}\n$$` : `$${tex}$`;
    }
  }

  try {
    const range = sel.getRangeAt(0);
    const container = document.createElement('div');
    container.appendChild(range.cloneContents());

    const serialize = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node as Element;
      if (el.classList.contains('katex')) {
        const tex = texFromKatexElement(el);
        if (tex) {
          const display =
            el.classList.contains('katex-display') ||
            el.parentElement?.classList.contains('katex-display');
          return display ? `$$\n${tex}\n$$` : `$${tex}$`;
        }
        return '';
      }
      if (el.classList.contains('katex-mathml') || el.classList.contains('katex-html')) {
        return '';
      }
      if (el.tagName === 'BR') return '\n';
      let out = '';
      for (const child of Array.from(el.childNodes)) out += serialize(child);
      if (
        ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'TR', 'BLOCKQUOTE'].includes(el.tagName) &&
        out &&
        !out.endsWith('\n')
      ) {
        out += '\n';
      }
      return out;
    };

    const built = serialize(container).replace(/\n{3,}/g, '\n\n').trim();
    if (built) return built;
  } catch {
    // fall through
  }

  return plain;
}
