/**
 * Slice page-marked extract text for on-demand file_read.
 * Page markers: `--- page N ---` (from chat-api fileExtract).
 */

export const PAGE_MARKER_LINE = /^--- page (\d+) ---$/;

export type ExtractPage = { page: number; text: string };

export type SliceResult = {
  text: string;
  startPage: number;
  endPage: number;
  totalPages: number;
  hasMore: boolean;
  matchedFocus: boolean;
};

/** Parse `--- page N ---` blocks; unmarked text becomes a single page 1. */
export function parseExtractPages(raw: string): ExtractPage[] {
  const src = String(raw || '').replace(/\r\n/g, '\n');
  if (!src.trim()) return [];

  const lines = src.split('\n');
  const pages: ExtractPage[] = [];
  let curPage: number | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (curPage == null) return;
    pages.push({ page: curPage, text: buf.join('\n').trim() });
    buf = [];
  };

  for (const line of lines) {
    const m = line.trim().match(PAGE_MARKER_LINE);
    if (m) {
      flush();
      curPage = Number(m[1]);
      continue;
    }
    if (curPage == null) {
      // No markers yet — accumulate as page 1 preamble.
      curPage = 1;
    }
    buf.push(line);
  }
  flush();

  if (!pages.length && src.trim()) {
    return [{ page: 1, text: src.trim() }];
  }
  return pages;
}

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

/**
 * Return a window of pages. If `focus` is set, prefer the page window around
 * the first case-insensitive match (still bounded by maxPages).
 */
export function sliceExtractForRead(
  raw: string,
  opts: {
    startPage?: number;
    maxPages?: number;
    focus?: string;
    maxChars?: number;
  } = {},
): SliceResult {
  const pages = parseExtractPages(raw);
  const maxPages = clampInt(opts.maxPages, 8, 1, 40);
  const maxChars = clampInt(opts.maxChars, 28_000, 2_000, 80_000);
  const focus = String(opts.focus || '').trim();
  const totalPages = pages.length
    ? Math.max(...pages.map((p) => p.page))
    : 0;

  if (!pages.length) {
    return {
      text: '',
      startPage: 1,
      endPage: 0,
      totalPages: 0,
      hasMore: false,
      matchedFocus: false,
    };
  }

  let startPage = clampInt(opts.startPage, 1, 1, Math.max(1, totalPages));
  let matchedFocus = false;

  if (focus) {
    const needle = focus.toLowerCase();
    const hit = pages.find((p) => p.text.toLowerCase().includes(needle));
    if (hit) {
      matchedFocus = true;
      startPage = Math.max(1, hit.page - Math.floor((maxPages - 1) / 2));
    }
  }

  const byNum = new Map(pages.map((p) => [p.page, p]));
  const windowPages: ExtractPage[] = [];
  for (let n = startPage; n < startPage + maxPages; n++) {
    const p = byNum.get(n);
    if (p) windowPages.push(p);
  }

  let text = windowPages
    .map((p) => `--- page ${p.page} ---\n${p.text}`)
    .join('\n\n')
    .trim();
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n\n[…truncated to ${maxChars} chars]`;
  }

  const endPage = windowPages.length
    ? windowPages[windowPages.length - 1]!.page
    : startPage - 1;
  const hasMore = endPage < totalPages;

  return {
    text,
    startPage: windowPages[0]?.page ?? startPage,
    endPage,
    totalPages,
    hasMore,
    matchedFocus,
  };
}
