/**
 * ASCII / Unicode tree diagrams (├ └ │) are often wrapped in single backticks.
 * CommonMark turns soft line breaks inside code spans into spaces, so the tree
 * collapses into one gray inline pill. Promote those spans to fenced blocks and
 * re-insert newlines before branch markers when needed.
 */

const BRANCH_MARK = /[├└]/;
const TREE_LINE_MARK = /[├└│┃]/;

export function looksLikeAsciiTree(text: string): boolean {
  const t = String(text || '');
  // Require a real branch marker — a lone box corner is not enough.
  return BRANCH_MARK.test(t);
}

/**
 * Recover line breaks when CommonMark (or the model) flattened a tree into one
 * line: "Root ├─ a ├─ b └─ c NextRoot ├─ d"
 */
export function reflowCollapsedAsciiTree(text: string): string {
  const raw = String(text || '');
  if (!raw.trim()) return raw;
  if (raw.includes('\n') && BRANCH_MARK.test(raw)) {
    return raw.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  let out = raw;
  // Break before branch / vertical continuation markers.
  out = out.replace(/[ \t]+([├└│┃])/g, '\n$1');
  // After a leaf with real content, break before the next titled section
  // (often "Name（role）" / "Name (role)").
  out = out.replace(
    /(└─\s+\S[^\n]*?)\s+(?=[\u4e00-\u9fffA-Za-z][^\n]{0,60}[（(])/g,
    '$1\n',
  );

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function mapOutsideFences(text: string, fn: (segment: string) => string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((segment, idx) => (idx % 2 === 1 || segment.startsWith('```') ? segment : fn(segment)))
    .join('');
}

function branchCount(text: string): number {
  return (String(text || '').match(/[├└]/g) || []).length;
}

/**
 * Rewrite inline `tree…` / ``tree…`` spans that contain ASCII tree art into
 * fenced ```text blocks, before remark collapses their newlines to spaces.
 */
export function promoteInlineAsciiArtToFences(markdown: string): string {
  return mapOutsideFences(String(markdown || ''), (segment) =>
    segment.replace(/(`+)((?:(?!\1)[\s\S])*?)\1/g, (full, ticks: string, body: string) => {
      if (!looksLikeAsciiTree(body)) return full;
      const content = reflowCollapsedAsciiTree(body);
      if (branchCount(content) < 1) return full;
      // Keep tiny one-branch snippets inline (e.g. `├─ foo` as a short mention).
      if (branchCount(content) < 2 && !content.includes('\n')) return full;
      return `\n\n\`\`\`text\n${content}\n\`\`\`\n\n`;
    }),
  );
}
