/**
 * Recover ASCII / Unicode diagrams that models emit as ordinary prose or wrap
 * in single backticks. CommonMark collapses code-span newlines into spaces, so
 * these structures must be promoted before ReactMarkdown parses them.
 */

const UNICODE_BRANCH_RE = /(?:^|\s)[├└](?:[─━-]{1,3})/g;
const ASCII_BRANCH_RE = /(?:^|\s)(?:\+--+|\|--+|\\--+|`--+)\s*/g;
const BRANCH_LINE_RE = /^\s*(?:(?:[|│┃]\s*)*)(?:[├└](?:[─━-]{1,3})|\+--+|\|--+|\\--+|`--+)\s*/;
const BOX_CHAR_RE = /[┌┐└┘╔╗╚╝╭╮╰╯│║┃─━═]/g;
const BOX_TOP_RE = /[┌╔╭].*[┐╗╮]/;
const BOX_BOTTOM_RE = /[└╚╰].*[┘╝╯]/;

function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0;
  const count = (String(text || '').match(re) || []).length;
  re.lastIndex = 0;
  return count;
}

export function looksLikeUnicodeBox(text: string): boolean {
  const t = String(text || '');
  const chars = t.match(BOX_CHAR_RE) || [];
  if (chars.length < 6) return false;
  return (
    (BOX_TOP_RE.test(t) && BOX_BOTTOM_RE.test(t)) ||
    /[╔╗╚╝]/.test(t) ||
    /[╭╮╰╯]/.test(t)
  );
}

export function looksLikeAsciiTree(text: string): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (looksLikeUnicodeBox(t)) return false;
  const unicodeBranches = countMatches(t, UNICODE_BRANCH_RE);
  const asciiBranches = countMatches(t, ASCII_BRANCH_RE);
  return unicodeBranches + asciiBranches > 0;
}

export function looksLikeAsciiArt(text: string): boolean {
  return looksLikeAsciiTree(text) || looksLikeUnicodeBox(text);
}

function reflowUnicodeBox(text: string): string {
  return String(text || '')
    // Top border → first body row.
    .replace(/([┐╗╮])\s+(?=[│║┃])/g, '$1\n')
    // One body row → the next, or body → bottom border.
    .replace(/([│║┃])\s+(?=[│║┃└╚╰])/g, '$1\n')
    // A flattened second box starts after the previous bottom border.
    .replace(/([┘╝╯])\s+(?=[┌╔╭])/g, '$1\n')
    .trim();
}

/** Recover branch/row line breaks after model or CommonMark flattening. */
export function reflowCollapsedAsciiArt(text: string): string {
  const raw = String(text || '');
  if (!raw.trim()) return raw;
  // Trim first: fenced bodies often end with a trailing newline that is not a
  // real row break — that used to skip Unicode-box reflow entirely.
  let out = raw
    .trim()
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Even when some newlines already exist, keep running structural reflow —
  // models often leave boxes/trees half-flattened (e.g. top row broken, body glued).
  if (looksLikeUnicodeBox(out)) {
    return reflowUnicodeBox(out).replace(/\n{3,}/g, '\n\n').trim();
  }

  // Unicode branches.
  out = out.replace(/[ \t]+([├└](?:[─━-]{1,3}))/g, '\n$1');
  // Portable ASCII branches (+--, |--, \--, `--).
  out = out.replace(/[ \t]+(\+--+|\|--+|\\--+|`--+)/g, '\n$1');
  // After a leaf with real content, break before the next titled root.
  out = out.replace(
    /((?:└[─━-]{1,3}|\\--+|`--+)\s+\S[^\n]*?)\s+(?=[\u4e00-\u9fffA-Za-z][^\n]{0,60}[（(])/g,
    '$1\n',
  );
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Backward-compatible tree-specific name used by the renderer. */
export function reflowCollapsedAsciiTree(text: string): string {
  return reflowCollapsedAsciiArt(text);
}

function mapOutsideFences(text: string, fn: (segment: string) => string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((segment, idx) => (idx % 2 === 1 || segment.startsWith('```') ? segment : fn(segment)))
    .join('');
}

function structuralMarkCount(text: string): number {
  return (
    countMatches(text, UNICODE_BRANCH_RE) +
    countMatches(text, ASCII_BRANCH_RE) +
    (text.match(/[┌┐└┘╔╗╚╝╭╮╰╯]/g) || []).length
  );
}

function fenceText(content: string): string {
  return `\n\n\`\`\`text\n${content.trim()}\n\`\`\`\n\n`;
}

/**
 * Promote inline `diagram…` / ``diagram…`` spans to fenced text blocks.
 * Tiny one-branch mentions stay inline.
 */
export function promoteInlineAsciiArtToFences(markdown: string): string {
  return mapOutsideFences(String(markdown || ''), (segment) =>
    segment.replace(/(`+)((?:(?!\1)[\s\S])*?)\1/g, (full, _ticks: string, body: string) => {
      if (!looksLikeAsciiArt(body)) return full;
      const content = reflowCollapsedAsciiArt(body);
      const marks = structuralMarkCount(content);
      if (marks < 2 && !content.includes('\n')) return full;
      return fenceText(content);
    }),
  );
}

function paragraphLooksLikeAsciiArt(paragraph: string): boolean {
  const p = String(paragraph || '');
  if (looksLikeUnicodeBox(p)) return true;
  const branchLines = p.split('\n').filter((line) => BRANCH_LINE_RE.test(line)).length;
  if (branchLines >= 2) return true;
  // Historical/model-flattened paragraph with several branch tokens.
  return looksLikeAsciiTree(p) && structuralMarkCount(p) >= 3;
}

/**
 * Promote unfenced ASCII-art paragraphs too. This catches portable trees that
 * contain literal backticks (`-- child), which would otherwise corrupt Markdown
 * code-span parsing before the renderer gets a chance to inspect them.
 */
export function promotePlainAsciiArtBlocks(markdown: string): string {
  return mapOutsideFences(String(markdown || ''), (segment) =>
    segment
      .split(/(\n{2,})/)
      .map((part) => {
        if (/^\n{2,}$/.test(part) || !paragraphLooksLikeAsciiArt(part)) return part;
        return fenceText(reflowCollapsedAsciiArt(part));
      })
      .join(''),
  );
}

/** Apply plain-block recovery first, then inline-code recovery, then reflow
 *  already-fenced diagrams that models flattened onto one line. */
export function normalizeAsciiArtMarkdown(markdown: string): string {
  return reflowFencedAsciiArtBlocks(
    promoteInlineAsciiArtToFences(promotePlainAsciiArtBlocks(markdown)),
  );
}

/**
 * Models often put ASCII diagrams in ```text fences but flatten newlines
 * inside the fence. prepareChatMarkdown previously skipped those segments;
 * reflow them so every consumer (chat + file preview) sees real line breaks.
 */
export function reflowFencedAsciiArtBlocks(markdown: string): string {
  return String(markdown || '').replace(
    /```([^\n`]*)\n([\s\S]*?)```/g,
    (full, info: string, body: string) => {
      const lang = String(info || '')
        .trim()
        .split(/\s+/)[0]
        ?.toLowerCase();
      const explicitDiagram =
        lang === 'text' ||
        lang === 'plaintext' ||
        lang === 'ascii' ||
        lang === 'txt';
      // Bare ``` (no language): only reflow when the body is a strong diagram signal —
      // avoids rewriting casual prose examples that happen to use a few box chars.
      const bareFence = !lang;
      if (!explicitDiagram && !bareFence) return full;
      if (!looksLikeAsciiArt(body)) return full;
      if (
        bareFence &&
        !looksLikeUnicodeBox(body) &&
        structuralMarkCount(body) < 4
      ) {
        return full;
      }
      const next = reflowCollapsedAsciiArt(body);
      if (next === body.trim()) return full;
      return `\`\`\`${info}\n${next}\n\`\`\``;
    },
  );
}
