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

export type AutoStartResult = {
  startPage: number;
  skippedToc: boolean;
  bodyStartPage: number | null;
  source: 'explicit' | 'outline' | 'heuristic' | 'focus' | 'default';
};

const TOC_HEADING =
  /(?:^|\n)\s*(?:table\s+of\s+contents|\bcontents\b|目录|目次)\s*(?:\n|$)/i;
/** focus must be primarily a TOC request — not any phrase containing "contents". */
const TOC_FOCUS =
  /^(?:目录|目次|table\s+of\s+contents|contents|toc)(?:\s+page)?\s*$/i;
const DOT_LEADER = /\.{3,}\s*\d{1,4}\s*$/;
const TRAILING_PAGE_NUM = /\S.{2,70}\s+\d{1,4}\s*$/;
/** Numbered TOC entries like "1.1 Introduction 6" or "1. 2 Title 9". */
const NUMBERED_TOC_ENTRY =
  /^\d+\.\s*\d+\s+\S.{0,70}?\s+\d{1,4}\s*$/;

/**
 * PDF extracts often flatten a page to one line. Split into pseudo-rows so
 * TOC scoring still works without real newlines / dot leaders.
 */
function tocCandidateChunks(raw: string): string[] {
  const lines = raw
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 4) return lines;

  const one = (lines[0] || raw).trim();
  if (!one) return [];

  // Prefer "1.1 Title 6" / "1. 2 Title 9" section breaks (PDF-flattened TOCs).
  const bySection = one
    .split(/(?=\b\d+\.\s*\d+\s+[\p{L}\p{N}])/u)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bySection.length >= 4) return bySection;

  // Looser "Title 12" splits only when a Contents heading is present.
  if (
    TOC_HEADING.test(one) ||
    /^(table of contents|contents|目录|目次)\b/i.test(one)
  ) {
    const pageChunks = one.match(/\S.{3,80}?\s+\d{1,3}(?=\s+\S|$)/g);
    if (pageChunks && pageChunks.length >= 4) {
      return pageChunks.map((s) => s.trim());
    }
  }
  return lines.length ? lines : [one];
}

function tocChunkHitRatio(chunks: string[]): { ratio: number; numbered: number } {
  if (!chunks.length) return { ratio: 0, numbered: 0 };
  let hits = 0;
  let numbered = 0;
  for (const c of chunks) {
    if (NUMBERED_TOC_ENTRY.test(c)) {
      hits += 1;
      numbered += 1;
      continue;
    }
    if (DOT_LEADER.test(c) || (TRAILING_PAGE_NUM.test(c) && c.length < 140)) {
      hits += 1;
    }
  }
  return { ratio: hits / chunks.length, numbered };
}

/** True when a page looks like a table-of-contents listing. */
export function looksLikeTocPage(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const chunks = tocCandidateChunks(raw);
  const first = chunks[0] || raw;
  const hasHeading =
    TOC_HEADING.test(raw) ||
    /^(table of contents|contents|目录|目次)\b/i.test(first);

  if (chunks.length >= 3) {
    const { ratio, numbered } = tocChunkHitRatio(chunks);
    if (hasHeading && ratio >= 0.25) return true;
    // Dot-leader TOCs without a heading — require real leaders, not "Chapter 1 …".
    if (!hasHeading && raw.length < 4500) {
      const leaders = chunks.filter((c) => DOT_LEADER.test(c)).length;
      if (leaders >= 4 && leaders / chunks.length >= 0.45) return true;
    }
    // Flattened numbered TOC without a "Contents" heading (common in PDFs).
    if (numbered >= 4 && numbered / chunks.length >= 0.5 && raw.length < 4500) {
      return true;
    }
  }
  if (hasHeading && raw.length < 2800 && chunks.length >= 3) return true;
  return false;
}

/**
 * Scan early pages for a TOC stretch; return the first substantial page after it.
 * Returns null when no TOC is detected.
 */
export function findBodyStartPage(
  pages: ExtractPage[],
  scanLimit = 40,
): number | null {
  if (!pages.length) return null;
  const limit = Math.min(pages.length, scanLimit);
  let tocEnd: number | null = null;

  for (let i = 0; i < limit; i++) {
    const p = pages[i]!;
    if (looksLikeTocPage(p.text)) {
      tocEnd = p.page;
      continue;
    }
    if (tocEnd != null && p.text.trim().length >= 120) {
      return p.page;
    }
  }
  if (tocEnd != null) {
    const next = pages.find((p) => p.page > tocEnd!);
    return next?.page ?? null;
  }
  return null;
}

/**
 * First-call default: skip TOC via PDF outline body_start (when in range) or text heuristic.
 * Explicit start_page / TOC-focused focus keep page 1 (or the requested page).
 */
export function resolveAutoStartPage(opts: {
  pages: ExtractPage[];
  startPageExplicit: boolean;
  startPage: number;
  focus?: string;
  outlineBodyStart?: number | null;
}): AutoStartResult {
  const focus = String(opts.focus || '').trim();
  if (opts.startPageExplicit) {
    return {
      startPage: opts.startPage,
      skippedToc: false,
      bodyStartPage: null,
      source: 'explicit',
    };
  }
  if (focus && TOC_FOCUS.test(focus)) {
    return {
      startPage: 1,
      skippedToc: false,
      bodyStartPage: null,
      source: 'explicit',
    };
  }
  if (focus) {
    return {
      startPage: opts.startPage,
      skippedToc: false,
      bodyStartPage: null,
      source: 'focus',
    };
  }

  // Paged-extract catalogs for container-like formats (ZIP/PPTX/DOCX/XLSX).
  // These catalogs are usually page 1 (index/outline) and should be skipped
  // unless the caller explicitly requests TOC via focus or start_page=1.
  const firstBody = opts.pages[0]?.text ? String(opts.pages[0]!.text).trim() : '';
  const looksLikeCatalogPage = /^#\s*(?:ZIP catalog:|PPTX outline:|DOCX outline:|Excel sheets:)/i.test(
    firstBody,
  );
  if (looksLikeCatalogPage) {
    const maxPage = opts.pages.length ? Math.max(...opts.pages.map((p) => p.page)) : 0;
    if (maxPage >= 2) {
      return {
        startPage: 2,
        skippedToc: true,
        bodyStartPage: 2,
        source: 'heuristic',
      };
    }
  }

  const maxAvail = opts.pages.length
    ? Math.max(...opts.pages.map((p) => p.page))
    : 0;
  const outline =
    opts.outlineBodyStart &&
    opts.outlineBodyStart > 1 &&
    opts.outlineBodyStart <= maxAvail
      ? opts.outlineBodyStart
      : null;
  const heuristic = findBodyStartPage(opts.pages);
  const body = outline ?? heuristic;

  if (body && body > 1) {
    return {
      startPage: body,
      skippedToc: true,
      bodyStartPage: body,
      source: outline ? 'outline' : 'heuristic',
    };
  }
  return {
    startPage: 1,
    skippedToc: false,
    bodyStartPage: body,
    source: 'default',
  };
}

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
