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

/** Unwrap `[![alt](src)](href)` → `![alt](src)`. */
function unwrapLinkedImage(line: string): string {
  const m = /^\[(!\[[^\]]*\]\([^)]*\))\]\([^)]*\)$/.exec(line.trim());
  return m ? m[1] : line.trim();
}

/**
 * Parse a CommonMark image destination, including optional title:
 * `![alt](url)`, `![alt](<url>)`, `![alt](url "title")`.
 */
function parseMarkdownImage(
  line: string,
): { alt: string; src: string } | null {
  const trimmed = unwrapLinkedImage(line);
  const m =
    /^!\[([^\]]*)\]\(\s*<?([^>\s)]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)$/.exec(
      trimmed,
    );
  if (!m) return null;
  return { alt: m[1], src: m[2].trim() };
}

const BADGE_ALT_RE =
  /creative\s*commons|\bcc\s*license\b|\bcc0\b|\bcc[- ]?by\b|^zero$/i;

const BADGE_HOST_RE =
  /(^|\.)(licensebuttons\.net|i\.creativecommons\.org|mirrors\.creativecommons\.org)$/i;

function isChromeBadgeImage(alt: string, src: string): boolean {
  if (BADGE_ALT_RE.test(alt.trim())) return true;
  try {
    const host = new URL(src).hostname;
    if (BADGE_HOST_RE.test(host)) return true;
  } catch {
    // relative / invalid — not a known badge CDN
  }
  return false;
}

function isBadImageLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (IMAGE_PLACEHOLDER_LINE.test(trimmed)) return true;

  const parsed = parseMarkdownImage(trimmed);
  if (parsed) {
    const src = parsed.src.toLowerCase();
    if (!src || src === '#' || src.startsWith('javascript:')) return true;
    if (isChromeBadgeImage(parsed.alt, parsed.src)) return true;
    return false;
  }

  // `![…]` present but not a parseable destination (title-bearing forms
  // parse above) — placeholder noise.
  if (/^!\[[^\]]*\]/.test(unwrapLinkedImage(trimmed))) return true;
  return false;
}

/** Pure: clean an extract body for rendering. */
export function cleanUrlExtractText(raw: string, opts?: { title?: string }): string {
  const text = String(raw || '');
  if (!text.trim()) return '';
  let lines = text.replace(/\r\n/g, '\n').split('\n');
  lines = stripProviderHeaderBlock(lines, opts?.title);
  lines = lines.filter((line) => !isBadImageLine(line));
  let out = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  out = rewriteDirtyCitationLinks(out);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function footnoteFromLabel(label: string): string {
  const t = String(label).trim();
  if (/^\d{1,4}[a-z]?$/i.test(t)) return `[${t}]`;
  return t;
}

/** Mirror of chat-api cleanContent: about:/hash citation → footnote numbers. */
function rewriteDirtyCitationLinks(text: string): string {
  const src = String(text || '');
  if (!src) return '';
  const chunks: string[] = [];
  let fence = false;
  let buf: string | null = null;
  const flushProse = () => {
    if (buf == null) return;
    chunks.push(
      buf
        .replace(
          /\[([^\]]{1,120})\]\(\s*(about:[^)\s]+|#[^)\s]*)(?:\s+"[\s\S]*?")?\s*\)/gi,
          (_m, label: string) => footnoteFromLabel(label),
        )
        .replace(
          /\[([^\]]{1,120})\]\(\s*#\s*\)/g,
          (_m, label: string) => footnoteFromLabel(label),
        ),
    );
    buf = null;
  };
  for (const line of src.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) {
      if (fence) {
        chunks.push(line);
        fence = false;
      } else {
        flushProse();
        fence = true;
        chunks.push(line);
      }
      continue;
    }
    if (fence) {
      chunks.push(line);
      continue;
    }
    buf = buf == null ? line : `${buf}\n${line}`;
  }
  flushProse();
  return chunks.join('\n');
}
