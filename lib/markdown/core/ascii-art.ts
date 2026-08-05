/**
 * Recover ASCII / Unicode diagrams that models emit as ordinary prose or wrap
 * in single backticks. CommonMark collapses code-span newlines into spaces, so
 * these structures must be promoted before ReactMarkdown parses them.
 *
 * Only rewrite when the diagram is still flat / half-glued. Well-formed
 * multi-line trees and nested boxes must pass through unchanged.
 */

const UNICODE_BRANCH_RE = /(?:^|\s)[├└](?:[─━-]{1,3})/g;
/**
 * `|---` inside GFM tables (`|------|---|`) is NOT a tree branch. `(?!-)` pins
 * the dash run to its full length so the `(?!\s*\|)` guard cannot be dodged by
 * backtracking to a shorter `|--` inside a longer separator cell.
 */
const ASCII_BRANCH_RE = /(?:^|\s)(?:\+--+|\\--+|`--+|\|--+(?!-)(?!\s*\|))\s*/g;
const BRANCH_LINE_RE =
  /^\s*(?:(?:[|│┃]\s*)*)(?:[├└](?:[─━-]{1,3})|\+--+|\|--+(?!-)(?!\s*\|)|\\--+|`--+)\s*/;
/** `| --- | --- |` style delimiter, even when rows were smashed onto one line. */
const GFM_SEPARATOR_RE = /\|\s*:?-{3,}:?\s*\|/;
const BOX_CHAR_RE = /[┌┐└┘╔╗╚╝╭╮╰╯│║┃─━═]/g;
const BOX_TOP_RE = /[┌╔╭].*[┐╗╮]/;
const BOX_BOTTOM_RE = /[└╚╰].*[┘╝╯]/;

/** A line that belongs to a diagram frame / tree / banner — not prose. */
export function isAsciiStructuralLine(line: string): boolean {
  const s = String(line || '').trimEnd();
  const t = s.trim();
  if (!t) return false;
  if (/^[┌╔╭└╚╰]/.test(t)) return true;
  if (/^[│║┃]/.test(t)) return true;
  if (BRANCH_LINE_RE.test(s)) return true;
  // Underscore / dash frames and pipe rows used in sequence art.
  if (/_{3,}/.test(t) && (t.includes('|') || /^_+$/.test(t.replace(/\s/g, '')))) return true;
  if (/^\|/.test(t) && (t.match(/\|/g) || []).length >= 2) return true;
  // Section banners: ═══ title ═══
  if (/[═]{4,}/.test(t) || /^[-=_]{8,}$/.test(t)) return true;
  // Pure box-drawing / connector rows.
  if (/^[\s┌┐└┘╔╗╚╝╭╮╰╯│║┃─━═├┤┬┴┼▲▼▶◀◄↓↑←→+\-|\\/_]+$/.test(t) && /[┌┐└┘╔╗╚╝╭╮╰╯│║┃─━═├┤┬┴┼]/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Peel leading/trailing prose out of a block that mixes explanation with a
 * diagram (common when models wrap everything in one ```text fence).
 *
 * Short labels above a tree (`Root`, `app`) stay with the art; only
 * sentence-like explanation is peeled.
 */
export function looksLikeExplanatoryProseLine(line: string): boolean {
  const t = String(line || '').trim();
  if (!t) return false;
  if (isAsciiStructuralLine(line)) return false;
  if (/[。！？；]/.test(t)) return true;
  if (t.length >= 28) return true;
  if (/(对齐|下面|明白|说明|需要|输出|框线|汉字|重新|随时说|按「|占\s*\d+\s*列|注：|上述)/.test(t)) {
    return true;
  }
  return false;
}

export function partitionAsciiArtContent(text: string): {
  proseBefore: string;
  art: string;
  proseAfter: string;
} {
  const raw = String(text ?? '');
  const lines = raw.split('\n');
  let first = -1;
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isAsciiStructuralLine(lines[i]!)) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) {
    return { proseBefore: '', art: raw, proseAfter: '' };
  }

  let artStart = first;
  while (artStart > 0) {
    const prev = lines[artStart - 1]!;
    if (prev.trim() === '') {
      artStart--;
      continue;
    }
    if (looksLikeExplanatoryProseLine(prev)) break;
    // Keep short titles / tree roots with the diagram.
    artStart--;
  }

  let artEnd = last;
  while (artEnd + 1 < lines.length) {
    const next = lines[artEnd + 1]!;
    if (next.trim() === '') {
      artEnd++;
      continue;
    }
    if (looksLikeExplanatoryProseLine(next)) break;
    artEnd++;
  }

  // Drop only blank lines that sit between peeled prose and art.
  while (artStart < first && lines[artStart]!.trim() === '') artStart++;
  while (artEnd > last && lines[artEnd]!.trim() === '') artEnd--;

  const proseBefore = lines.slice(0, artStart).join('\n').replace(/\n+$/, '');
  const art = lines.slice(artStart, artEnd + 1).join('\n');
  const proseAfter = lines.slice(artEnd + 1).join('\n').replace(/^\n+/, '');
  return { proseBefore, art, proseAfter };
}

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
  const hasCorners =
    (BOX_TOP_RE.test(t) && BOX_BOTTOM_RE.test(t)) ||
    /[╔╗╚╝]/.test(t) ||
    /[╭╮╰╯]/.test(t);
  if (!hasCorners) return false;

  const lines = t.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= 1) {
    const trimmed = t.trim();
    // Flattened one-line boxes start with a corner. Prose that only *lists*
    // glyphs ("用 ┌┐│─ 对齐") must not become a ```text fence.
    if (!/^[┌╔╭]/.test(trimmed)) return false;
    return true;
  }

  // Multi-line: require real box rows, not a paragraph that happens to
  // mention corners inside parentheses / quotes.
  const structural = lines.filter((l) => {
    const s = l.trim();
    return (
      /^[┌╔╭].*[┐╗╮]\s*$/.test(s) ||
      /^[└╚╰].*[┘╝╯]\s*$/.test(s) ||
      /^[│║┃]/.test(s) ||
      /^[\s┌┐└┘╔╗╚╝╭╮╰╯│║┃─━═├┤┬┴┼]+$/.test(s)
    );
  }).length;
  return structural >= 2;
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

/**
 * A GFM table — even one whose rows the model smashed onto a single line — must
 * never be fenced as a diagram: fencing hides it from the table repair pass and
 * leaves the reader with a horizontally scrolling code block.
 *
 * Two escape hatches:
 * - a `|---|---|` delimiter somewhere in the block (classic table source);
 * - a run of 2+ rows that each look like a pipe row (tables deleting/forgetting
 *   their delimiter — the repair pass will re-fill it, but only if we let them
 *   through unfenced).
 */
export function looksLikeGfmTableSource(text: string): boolean {
  const t = String(text || '');
  if (GFM_SEPARATOR_RE.test(t) && (t.match(/\|/g) || []).length >= 6) {
    return true;
  }
  // Separator-less table body: several consecutive rows sharing the same
  // pipe-heavy shape. This is the shape `insertMissingTableSeparator` repairs —
  // keep it out of `text` fences so that pass can run.
  // Separator-less table body: at least 2 consecutive lines that are each
  // pipe-heavy (3+ pipes with content between) — mirrors what
  // `insertMissingTableSeparator` repairs. Two rows keeps ASCII tree one-offs
  // (`|`, `|\`) from being mistaken for tables.
  const lines = t.split('\n');
  let run = 0;
  for (const line of lines) {
    const trim = line.trim();
    const cells = trim.startsWith('|') && trim.endsWith('|')
      ? trim.split('|').slice(1, -1)
      : [];
    // A table cell carries real words (≥2 letters/digits/CJK). ASCII frame
    // tops/bottoms (`|______|`), single-char stubs (`|__|`), padding — don't.
    const meaty = cells.filter(
      (c) => c.replace(/[^\p{L}\p{N}]/gu, '').length >= 2,
    );
    if (cells.length >= 3 && meaty.length >= 3) {
      run += 1;
      if (run >= 2) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

export function looksLikeAsciiArt(text: string): boolean {
  if (looksLikeGfmTableSource(text)) return false;
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
  if (looksLikeGfmTableSource(p)) return false;
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
 *
 * When a paragraph mixes leading prose with a diagram, only the diagram is
 * fenced — the explanation stays outside as normal markdown.
 */
export function promotePlainAsciiArtBlocks(markdown: string): string {
  return mapOutsideFences(String(markdown || ''), (segment) =>
    segment
      .split(/(\n{2,})/)
      .map((part) => {
        if (/^\n{2,}$/.test(part) || !paragraphLooksLikeAsciiArt(part)) return part;
        const { proseBefore, art, proseAfter } = partitionAsciiArtContent(part);
        const body = reflowCollapsedAsciiArt(art);
        if (!looksLikeAsciiArt(body) && !paragraphLooksLikeAsciiArt(body)) {
          return fenceText(reflowCollapsedAsciiArt(part));
        }
        const chunks: string[] = [];
        if (proseBefore.trim()) chunks.push(proseBefore.trimEnd());
        chunks.push(fenceText(body).trim());
        if (proseAfter.trim()) chunks.push(proseAfter.trimStart());
        return `\n\n${chunks.join('\n\n')}\n\n`;
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
 * Also peel leading/trailing prose out of mixed ```text fences so explanations
 * are not trapped in a non-wrapping code chrome.
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

      const { proseBefore, art, proseAfter } = partitionAsciiArtContent(body);
      const next = reflowCollapsedAsciiArt(art);
      const artLooks = looksLikeAsciiArt(next) || looksLikeAsciiArt(art);
      if (!artLooks) {
        const collapsed = reflowCollapsedAsciiArt(body);
        if (collapsed === lightNormalize(body)) return full;
        return `\`\`\`${info}\n${collapsed}\n\`\`\``;
      }

      const fenceInfo = info || 'text';
      const fenced = `\`\`\`${fenceInfo}\n${next.replace(/^\n+/, '').replace(/\n+$/, '')}\n\`\`\``;
      const mixed = Boolean(proseBefore.trim() || proseAfter.trim());
      if (!mixed) {
        if (next === lightNormalize(body) || next === body.replace(/^\n+/, '').replace(/\n+$/, '')) {
          return full;
        }
        return fenced;
      }

      const chunks: string[] = [];
      if (proseBefore.trim()) chunks.push(proseBefore.trimEnd());
      chunks.push(fenced);
      if (proseAfter.trim()) chunks.push(proseAfter.trimStart());
      return chunks.join('\n\n');
    },
  );
}
