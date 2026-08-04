/**
 * Recover ASCII / Unicode diagrams that models emit as ordinary prose or wrap
 * in single backticks. CommonMark collapses code-span newlines into spaces, so
 * these structures must be promoted before ReactMarkdown parses them.
 *
 * Only rewrite when the diagram is still flat / half-glued. Well-formed
 * multi-line trees and nested boxes must pass through unchanged.
 */

const UNICODE_BRANCH_RE = /(?:^|\s)[├└](?:[─━-]{1,3})/g;
/** `|---` inside GFM tables (`| --- |`) is NOT a tree branch — negative lookahead. */
const ASCII_BRANCH_RE = /(?:^|\s)(?:\+--+|\\--+|`--+|\|--+(?!\s*\|))\s*/g;
const BRANCH_LINE_RE =
  /^\s*(?:(?:[|│┃]\s*)*)(?:[├└](?:[─━-]{1,3})|\+--+|\|--+(?!\s*\|)|\\--+|`--+)\s*/;
const BOX_CHAR_RE = /[┌┐└┘╔╗╚╝╭╮╰╯│║┃─━═]/g;
const BOX_TOP_RE = /[┌╔╭].*[┐╗╮]/;
const BOX_BOTTOM_RE = /[└╚╰].*[┘╝╯]/;

function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0;
  const count = (String(text || '').match(re) || []).length;
  re.lastIndex = 0;
  return count;
}

function lightNormalize(text: string): string {
  return String(text || '')
    .trim()
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

/**
 * Classic sequence / frame diagrams built from `|`, `_`, `-`, `+`, arrows —
 * without Unicode box-drawing and often without `+---` tree branches.
 *
 * These must be fenced before GFM table repair: a lone `|` in
 * `____|____` gets rewritten into `| ____ | ____ |` and shreds the figure.
 */
export function looksLikeAsciiLineArt(text: string): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (looksLikeUnicodeBox(t) || looksLikeAsciiTree(t)) return false;

  const nonEmpty = t.split('\n').filter((l) => l.trim().length > 0);
  if (nonEmpty.length < 4) return false;

  const pipeLines = nonEmpty.filter((l) => l.includes('|')).length;
  const underscoreLines = nonEmpty.filter((l) => /_{3,}/.test(l)).length;
  const edgeDashLines = nonEmpty.filter((l) =>
    /(?:^|[^|\-\s])[-+]{3,}(?:[^|\-\s]|$)/.test(l) || /^\s*[+|].*[+|]\s*$/.test(l),
  ).length;
  const arrowLines = nonEmpty.filter((l) =>
    /(?:<-+|-+>|<--+|--+>|====+>|<====+)/.test(l),
  ).length;
  const struct = (t.match(/[|_\-+=<>^v/\\]/g) || []).length;

  // Real GFM tables: almost every line is a pipe-row and a separator exists.
  const gfmSep = nonEmpty.filter((l) => {
    const s = l.trim();
    return /^[\s|:\-]+$/.test(s) && /-{3,}/.test(s) && (s.match(/\|/g) || []).length >= 2;
  }).length;
  if (gfmSep >= 1 && pipeLines >= nonEmpty.length - 1) {
    return false;
  }

  // Underscore-framed boxes (common in GLM sequence diagrams).
  if (pipeLines >= 3 && underscoreLines >= 2 && nonEmpty.length >= 4) return true;
  // Pipe frames + arrows (browser → CDN → origin).
  if (pipeLines >= 4 && arrowLines >= 1 && struct >= 16) return true;
  // Dense multi-line pipe art that is not a clean table.
  if (pipeLines >= 5 && struct >= 24 && (underscoreLines >= 1 || edgeDashLines >= 2)) {
    return true;
  }
  return false;
}

export function looksLikeAsciiArt(text: string): boolean {
  return (
    looksLikeAsciiTree(text) ||
    looksLikeUnicodeBox(text) ||
    looksLikeAsciiLineArt(text)
  );
}

function reflowUnicodeBox(text: string): string {
  return String(text || '')
    .replace(/([┐╗╮])\s+(?=[│║┃])/g, '$1\n')
    .replace(/([│║┃])\s+(?=[│║┃└╚╰])/g, '$1\n')
    .replace(/([┘╝╯])\s+(?=[┌╔╭])/g, '$1\n')
    .trim();
}

/**
 * True when a Unicode box is still smashed (one line / half-glued) and needs
 * row recovery. Nested CSS-style box models already have many lines with
 * multiple `│` per row — reflow would shred them (`│  │` is outer+inner, not
 * a row boundary).
 */
export function needsUnicodeBoxReflow(text: string): boolean {
  const t = String(text || '');
  if (!looksLikeUnicodeBox(t)) return false;
  const lines = t.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return true;

  // Half-flat glue. Nested rows like `│  ┌──┐  │` must NOT count as glue.
  const glued = lines.some((l) => {
    const s = l.trimEnd();
    return (
      /[│║┃]\s+[└╚╰][─━═]*[┘╝╯]\s*$/.test(s) ||
      /^[┌╔╭].*[┐╗╮]\s+[│║┃]/.test(s)
    );
  });
  if (glued) return true;

  if (lines.length >= 3 && lines.some((l) => (l.match(/[│║┃]/g) || []).length >= 2)) {
    return false;
  }
  if (lines.length >= 3) return false;
  return true;
}

/** True when a tree still has multiple branches jammed onto one line. */
export function needsAsciiTreeReflow(text: string): boolean {
  const t = String(text || '');
  if (!looksLikeAsciiTree(t)) return false;
  const lines = t.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return true;
  // Already one-branch-per-line layout — leave indentation alone.
  return lines.some((l) => {
    const marks =
      countMatches(l, UNICODE_BRANCH_RE) + countMatches(l, ASCII_BRANCH_RE);
    return marks >= 2;
  });
}

function reflowAsciiTree(text: string): string {
  let out = text;
  out = out.replace(/[ \t]+([├└](?:[─━-]{1,3}))/g, '\n$1');
  // Same table-safe negative lookahead as ASCII_BRANCH_RE.
  out = out.replace(/[ \t]+(\+--+|\\--+|`--+|\|--+(?!\s*\|))/g, '\n$1');
  out = out.replace(
    /((?:└[─━-]{1,3}|\\--+|`--+)\s+\S[^\n]*?)\s+(?=[\u4e00-\u9fffA-Za-z][^\n]{0,60}[（(])/g,
    '$1\n',
  );
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Recover branch/row line breaks after model or CommonMark flattening. */
export function reflowCollapsedAsciiArt(text: string): string {
  const raw = String(text || '');
  if (!raw.trim()) return raw;

  if (looksLikeUnicodeBox(raw)) {
    const normalized = lightNormalize(raw);
    if (!needsUnicodeBoxReflow(normalized)) return normalized;
    return reflowUnicodeBox(normalized).replace(/\n{3,}/g, '\n\n').trim();
  }

  if (looksLikeAsciiTree(raw)) {
    const normalized = lightNormalize(raw);
    if (!needsAsciiTreeReflow(normalized)) return normalized;
    return reflowAsciiTree(normalized);
  }

  // Pipe/underscore sequence art: do not trim leading spaces (centering pads).
  if (looksLikeAsciiLineArt(raw)) {
    return String(raw || '').replace(/^\n+/, '').replace(/\n+$/, '');
  }

  return lightNormalize(raw);
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
  // Keep leading indentation — sequence diagrams pad the first line to center
  // frames. Only strip blank lines around the block.
  const body = String(content || '').replace(/^\n+/, '').replace(/\n+$/, '');
  return `\n\n\`\`\`text\n${body}\n\`\`\`\n\n`;
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
  if (looksLikeAsciiLineArt(p)) return true;
  const branchLines = p.split('\n').filter((line) => BRANCH_LINE_RE.test(line)).length;
  if (branchLines >= 2) return true;
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
 * inside the fence. Only rewrite when reflow actually changes the body.
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
      // Keep the original fence body when nothing structural changed (preserves
      // trailing newline / indentation the author already got right).
      if (next === lightNormalize(body)) return full;
      return `\`\`\`${info}\n${next}\n\`\`\``;
    },
  );
}
