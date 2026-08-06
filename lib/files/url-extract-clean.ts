/**
 * Conservative client-side cleaning for URL Preview extract text (plan 006 U3).
 *
 * Belt behind the server-side normalizer in chat-api (U4): strip provider
 * wrapper headers and image placeholders so Text mode renders decently even
 * against an unpatched/stale chat-api. Line-local rules only — never reorders
 * or trims genuine prose, MUST be idempotent, MUST NOT touch markdown
 * structure (headings, lists, links, fences, tables, real images).
 */

/** Strip Jina-keyless style header block at the very top of the document. */
function stripProviderHeaderBlock(lines: string[], title?: string): string[] {
  const out = [...lines];
  const headerRe = /^(Title|URL Source|Markdown Content|Warning|Note)\s*:/i;
  // Drop leading blank lines, then any consecutive header lines, then the
  // blanks after them (the wrapper separates header from body with a blank).
  let i = 0;
  while (i < out.length && !out[i].trim()) i += 1;
  let sawHeader = false;
  while (i < out.length && headerRe.test(out[i])) {
    sawHeader = true;
    i += 1;
  }
  if (sawHeader) {
    while (i < out.length && !out[i].trim()) i += 1;
    out.splice(0, i);
  }
  // Drop a duplicated standalone title line (provider repeats the page title).
  if (title && out.length && out[0].trim() === title.trim()) {
    out.splice(0, 1);
    while (out.length && !out[0].trim()) out.splice(0, 1);
  }
  return out;
}

const IMAGE_PLACEHOLDER_LINE =
  /^\s*(?:\[?Image\s*\d+\]?|!\[\s*(?:Image\s*\d*)?\s*\]\([^)]*\))\s*$/i;

function isBadImageLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (IMAGE_PLACEHOLDER_LINE.test(trimmed)) return true;
  // Markdown image whose src is empty/#/javascript: — src must not contain
  // whitespace or unescaped parens, so `)(#` inside is already garbage.
  const m = /^!\[[^\]]*\]\(([^()\s]*)\)$/.exec(trimmed);
  if (m) {
    const src = m[1].trim().toLowerCase();
    if (!src || src === '#' || src.startsWith('javascript:')) return true;
  } else if (/^!\[[^\]]*\]/.test(trimmed)) {
    // `![` present but the tail is not a sane `(src)` — placeholder noise.
    return true;
  }
  return false;
}

/** Pure: clean an extract body for rendering. */
export function cleanUrlExtractText(raw: string, opts?: { title?: string }): string {
  const text = String(raw || '');
  if (!text.trim()) return '';
  let lines = text.replace(/\r\n/g, '\n').split('\n');
  lines = stripProviderHeaderBlock(lines, opts?.title);
  lines = lines.filter((line) => !isBadImageLine(line));
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
