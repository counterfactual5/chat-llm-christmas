/** Dedicated literature search commands: `/papers …`, `/books …`. */

const PAPERS_CMD_RE = /^(?:\/papers|\/paper|\/论文|\/学术)\s+([\s\S]+)$/i;
const BOOKS_CMD_RE = /^(?:\/books|\/book|\/书籍|\/图书)\s+([\s\S]+)$/i;
/** Match `/books download` even when the identifier is missing or a placeholder. */
const BOOKS_DOWNLOAD_INTENT_RE =
  /^(?:\/books|\/book|\/书籍|\/图书)\s+download(?:\s+([\s\S]*))?$/i;
/** Match `/papers download` even when the identifier is missing or a placeholder. */
const PAPERS_DOWNLOAD_INTENT_RE =
  /^(?:\/papers|\/paper|\/论文|\/学术)\s+download(?:\s+([\s\S]*))?$/i;

export type LiteratureKind = 'papers' | 'books';

export type PaperAction = 'search' | 'details' | 'citations' | 'references' | 'author';

export type PaperSource = 'auto' | 'arxiv' | 'semantic' | 'openalex';

export type BookSource =
  | 'auto'
  | 'archive'
  | 'openlibrary'
  | 'gutenberg'
  | 'fpb'
  | 'aibooks'
  | 'trading'
  | 'github'
  | 'libgen';

const PAPER_ACTIONS = new Set(['details', 'citations', 'references', 'author']);
const BOOK_SOURCES = new Set([
  'archive',
  'ia',
  'openlibrary',
  'gutenberg',
  'fpb',
  'aibooks',
  'aiml',
  'trading',
  'quant',
  'ast',
  'github',
  'libgen',
  'auto',
]);

export type LiteratureCommand =
  | {
      kind: 'papers';
      action: PaperAction;
      query: string;
      source?: PaperSource;
      paperId?: string;
    }
  | {
      kind: 'papers';
      action: 'download';
      identifier: string;
      /** Present when the user typed download but the id is missing/placeholder. */
      error?: 'missing_identifier' | 'invalid_identifier';
    }
  | {
      kind: 'books';
      action: 'search';
      query: string;
      source?: BookSource;
    }
  | {
      kind: 'books';
      action: 'download';
      identifier: string;
      /** Present when the user typed download but the id is missing/placeholder. */
      error?: 'missing_identifier' | 'invalid_identifier';
    };

const BARE_ARXIV_RE = /^([0-9]{4}\.[0-9]{4,5}|[a-z\-]+\/[0-9]{7})(v\d+)?$/i;
const ARXIV_PREFIXED_RE = /^ARXIV:(([0-9]{4}\.[0-9]{4,5}|[a-z\-]+\/[0-9]{7})(v\d+)?)$/i;
const DOI_PREFIXED_RE = /^DOI:\S+$/i;
const BARE_DOI_RE = /^10\.\d{4,9}\/\S+$/i;
/** Semantic Scholar-style opaque ids (hex / alphanumeric, len ≥ 8). */
const S2_PAPER_ID_RE = /^[A-Za-z0-9]{8,}$/;

/**
 * Valid download targets: http(s) URL, 32-char MD5, `libgen:`+MD5, `gutenberg:`+id, or archive-style id.
 * Rejects empty values and placeholders like `<md5>`.
 */
export function isValidBookDownloadIdentifier(identifier: string): boolean {
  const id = String(identifier || '').trim();
  if (!id) return false;
  if (/[<>]/.test(id)) return false;
  if (/^https?:\/\/\S+$/i.test(id)) return true;
  if (/^gutenberg:\d+$/i.test(id)) return true;
  const libgen = id.match(/^libgen:([A-Za-z0-9._%-]+)$/i);
  if (libgen) return /^[a-f0-9]{32}$/i.test(libgen[1]);
  if (/^[a-f0-9]{32}$/i.test(id)) return true;
  return /^[A-Za-z0-9._%-]{3,}$/.test(id);
}

/**
 * Valid paper PDF download targets: https URL, `ARXIV:…`, `DOI:…`, bare arXiv id, or S2-style id.
 * Rejects empty values and placeholders like `<id>`.
 */
export function isValidPaperDownloadIdentifier(identifier: string): boolean {
  const id = String(identifier || '').trim();
  if (!id) return false;
  if (/[<>]/.test(id)) return false;
  if (/^https?:\/\/\S+$/i.test(id)) return true;
  if (ARXIV_PREFIXED_RE.test(id)) return true;
  if (DOI_PREFIXED_RE.test(id)) return true;
  if (BARE_DOI_RE.test(id)) return true;
  if (BARE_ARXIV_RE.test(id)) return true;
  if (S2_PAPER_ID_RE.test(id)) return true;
  return false;
}

/** Fields needed to pick a `/books download` target from a search hit. */
export type BookDownloadHitFields = {
  md5?: string;
  archiveId?: string;
  downloadUrl?: string;
  url?: string;
};

/** Extract Internet Archive identifier from an archive.org details URL. */
export function archiveIdFromUrl(url: string): string {
  const m = String(url || '').match(/archive\.org\/details\/([^/?#]+)/i);
  if (!m?.[1]) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Extract LibGen MD5 from ads.php / get.php style URLs. */
export function libgenMd5FromUrl(url: string): string {
  const m = String(url || '').match(/(?:[?&]md5=|\/md5\/)([a-f0-9]{32})\b/i);
  return m?.[1] ? m[1].toLowerCase() : '';
}

/**
 * Prefer identifiers the download API can resolve:
 * libgen MD5 → gutenberg:id / IA archiveId → https downloadUrl → archive.org / libgen URL.
 */
export function resolveBookDownloadIdentifier(hit: BookDownloadHitFields): string {
  const md5 = String(hit.md5 || '')
    .trim()
    .toLowerCase();
  if (/^[a-f0-9]{32}$/.test(md5)) return `libgen:${md5}`;

  const fromLibgenUrl = libgenMd5FromUrl(String(hit.url || ''));
  if (fromLibgenUrl) return `libgen:${fromLibgenUrl}`;

  const archiveId = String(hit.archiveId || '').trim();
  const libgenArchive = archiveId.match(/^libgen:([a-f0-9]{32})$/i);
  if (libgenArchive) return `libgen:${libgenArchive[1].toLowerCase()}`;
  const gutenberg = archiveId.match(/^gutenberg:(\d+)$/i);
  if (gutenberg) return `gutenberg:${gutenberg[1]}`;
  if (archiveId) return archiveId;

  const downloadUrl = String(hit.downloadUrl || '').trim();
  if (/^https?:\/\/\S+$/i.test(downloadUrl)) return downloadUrl;

  const fromUrl = archiveIdFromUrl(String(hit.url || ''));
  if (fromUrl) return fromUrl;

  return '';
}

/** Fields needed to pick a `/papers download` target from a search hit. */
export type PaperDownloadHitFields = {
  paperId?: string;
  pdfUrl?: string;
  doi?: string;
  url?: string;
};

/**
 * Prefer identifiers that details/citations/references can resolve.
 * OpenAlex `W…` ids are not Semantic Scholar paper ids — use DOI when present.
 */
export function resolvePaperActionId(hit: {
  paperId?: string;
  doi?: string;
}): string {
  const id = String(hit.paperId || '').trim();
  const doi = String(hit.doi || '')
    .trim()
    .replace(/^https?:\/\/doi\.org\//i, '');
  if (/^(?:OPENALEX:)?(?:https?:\/\/openalex\.org\/)?W\d+$/i.test(id)) {
    if (doi) return `DOI:${doi}`;
    const m = id.match(/W\d+/i);
    return m ? m[0] : id;
  }
  if (id) return id;
  if (doi) return `DOI:${doi}`;
  return '';
}

/** Extract bare arXiv id from abs/pdf/html URLs. */
export function arxivIdFromUrl(url: string): string {
  const m = String(url || '').match(
    /arxiv\.org\/(?:abs|pdf|html)\/(([0-9]{4}\.[0-9]{4,5}|[a-z\-]+\/[0-9]{7})(?:v\d+)?)/i,
  );
  return m?.[1] || '';
}

/**
 * Prefer identifiers that almost always resolve to an open-access PDF:
 * pdfUrl → ARXIV id → arXiv abs URL. Skip bare DOI/S2 without pdfUrl
 * (those often 404 with NO_OA_PDF after the user clicks Download).
 */
export function resolvePaperDownloadIdentifier(hit: PaperDownloadHitFields): string {
  const pdfUrl = String(hit.pdfUrl || '').trim();
  if (/^https?:\/\/\S+$/i.test(pdfUrl)) {
    const fromPdf = arxivIdFromUrl(pdfUrl);
    if (fromPdf) return `ARXIV:${fromPdf}`;
    return pdfUrl;
  }

  const paperId = String(hit.paperId || '').trim();
  if (ARXIV_PREFIXED_RE.test(paperId)) return paperId;
  if (BARE_ARXIV_RE.test(paperId)) return paperId;

  const fromUrl = arxivIdFromUrl(String(hit.url || ''));
  if (fromUrl) return `ARXIV:${fromUrl}`;

  return '';
}

export function bookDownloadCommandLabel(identifier: string): string {
  const id = String(identifier || '').trim();
  if (/^libgen:/i.test(id) || /^[a-f0-9]{32}$/i.test(id)) return 'Download';
  if (/^gutenberg:/i.test(id)) return 'Download';
  if (/^https?:\/\//i.test(id)) return 'Direct download';
  return 'Download';
}

/** Infer Process provider label when the download API omits `provider`. */
export function inferBookDownloadProvider(identifier: string): string {
  const id = String(identifier || '').trim();
  if (/^libgen:/i.test(id) || /^[a-f0-9]{32}$/i.test(id)) return 'libgen';
  if (/^gutenberg:/i.test(id)) return 'gutenberg';
  if (/^https?:\/\//i.test(id)) return 'direct';
  return 'internet-archive';
}

/** Infer Process provider label when the paper download API omits `provider`. */
export function inferPaperDownloadProvider(identifier: string): string {
  const id = String(identifier || '').trim();
  if (/^ARXIV:/i.test(id) || BARE_ARXIV_RE.test(id)) return 'arxiv';
  if (/^DOI:/i.test(id)) return 'doi';
  if (/^https?:\/\//i.test(id)) return 'direct';
  return 'semantic-scholar';
}

/** Strip brackets so titles cannot break markdown link labels. */
export function markdownLinkLabel(text: string, fallback = 'Page'): string {
  const cleaned = String(text || '')
    .replace(/[[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function normalizePaperSource(token: string): PaperSource | null {
  const t = token.toLowerCase();
  if (t === 's2' || t === 'semantic-scholar') return 'semantic';
  if (t === 'arxiv' || t === 'semantic' || t === 'openalex' || t === 'auto') return t;
  return null;
}

function normalizeBookSource(token: string): BookSource | null {
  const t = token.toLowerCase();
  if (t === 'ia') return 'archive';
  if (t === 'aiml' || t === 'ai-books') return 'aibooks';
  if (t === 'quant' || t === 'ast') return 'trading';
  if (t === 'libgen-li' || t === 'librarygenesis') return 'libgen';
  if (BOOK_SOURCES.has(t)) {
    if (t === 'aiml') return 'aibooks';
    if (t === 'quant' || t === 'ast') return 'trading';
    if (t === 'ia') return 'archive';
    return t as BookSource;
  }
  return null;
}

function splitHead(rest: string): { head: string; tail: string } {
  const m = rest.trim().match(/^(\S+)\s+([\s\S]+)$/);
  if (!m) return { head: rest.trim(), tail: '' };
  return { head: m[1], tail: m[2].trim() };
}

/** Strip conversational wrappers so "给我找找毛选" → "毛选". */
export function normalizeLiteratureQuery(raw: string): string {
  const original = String(raw || '').trim();
  if (!original) return '';
  const q = original
    .replace(
      /^(请|麻烦)?(帮我|给我|帮|请帮我|请给我)?\s*(找找|找一下|找下|找一本|找|搜搜|搜一下|搜索一下|搜索|查一下|查下|查找|看看)\s*/u,
      '',
    )
    .replace(/^(please\s+)?(find|search(\s+for)?|look\s+up)\s+/i, '')
    .replace(/^(a\s+book\s+(about|on|called)\s+)/i, '')
    .replace(/[？?！!。.]+$/u, '')
    .trim();
  return q || original;
}

export function parseLiteratureCommand(text: string): LiteratureCommand | null {
  // Normalize fullwidth slash and stray whitespace from edit/retry paths.
  const raw = String(text || '')
    .trim()
    .replace(/^[／⁄]/, '/')
    .replace(/^\s*\/\s*/, '/');

  // Prefer download intent over `/books <query>` so placeholders like
  // `libgen:<md5>` never fall through as a book search query.
  const downloadIntent = raw.match(BOOKS_DOWNLOAD_INTENT_RE);
  if (downloadIntent) {
    const identifier = String(downloadIntent[1] || '').trim();
    if (!identifier) {
      return {
        kind: 'books',
        action: 'download',
        identifier: '',
        error: 'missing_identifier',
      };
    }
    if (!isValidBookDownloadIdentifier(identifier)) {
      return {
        kind: 'books',
        action: 'download',
        identifier,
        error: 'invalid_identifier',
      };
    }
    return { kind: 'books', action: 'download', identifier };
  }

  // Prefer download intent over `/papers <query>` / paper actions.
  const paperDownloadIntent = raw.match(PAPERS_DOWNLOAD_INTENT_RE);
  if (paperDownloadIntent) {
    const identifier = String(paperDownloadIntent[1] || '').trim();
    if (!identifier) {
      return {
        kind: 'papers',
        action: 'download',
        identifier: '',
        error: 'missing_identifier',
      };
    }
    if (!isValidPaperDownloadIdentifier(identifier)) {
      return {
        kind: 'papers',
        action: 'download',
        identifier,
        error: 'invalid_identifier',
      };
    }
    return { kind: 'papers', action: 'download', identifier };
  }

  const papers = raw.match(PAPERS_CMD_RE);
  if (papers?.[1]?.trim()) {
    const rest = papers[1].trim();
    const { head, tail } = splitHead(rest);
    const headLower = head.toLowerCase();

    if (PAPER_ACTIONS.has(headLower) && tail) {
      if (headLower === 'author') {
        return {
          kind: 'papers',
          action: 'author',
          query: normalizeLiteratureQuery(tail),
        };
      }
      return {
        kind: 'papers',
        action: headLower as PaperAction,
        query: tail.trim(),
        paperId: tail.trim(),
      };
    }

    const source = normalizePaperSource(headLower);
    if (source && source !== 'auto' && tail) {
      return {
        kind: 'papers',
        action: 'search',
        query: normalizeLiteratureQuery(tail),
        source,
      };
    }

    return {
      kind: 'papers',
      action: 'search',
      query: normalizeLiteratureQuery(rest),
      source: 'auto',
    };
  }

  const books = raw.match(BOOKS_CMD_RE);
  if (books?.[1]?.trim()) {
    const rest = books[1].trim();
    const { head, tail } = splitHead(rest);
    const source = normalizeBookSource(head);
    if (source && source !== 'auto' && tail) {
      return {
        kind: 'books',
        action: 'search',
        query: normalizeLiteratureQuery(tail),
        source,
      };
    }
    return {
      kind: 'books',
      action: 'search',
      query: normalizeLiteratureQuery(rest),
      source: 'auto',
    };
  }

  return null;
}

export function formatLiteratureCommand(
  kind: LiteratureKind,
  query: string,
  opts?: { source?: string; action?: string },
): string {
  const q = String(query || '').trim();
  const action = opts?.action && opts.action !== 'search' ? opts.action : '';
  const source =
    opts?.source && opts.source !== 'auto' && !action ? opts.source : '';
  if (kind === 'books') {
    return source ? `/books ${source} ${q}` : `/books ${q}`;
  }
  if (action) return `/papers ${action} ${q}`;
  return source ? `/papers ${source} ${q}` : `/papers ${q}`;
}

export function formatBookDownloadCommand(identifier: string): string {
  return `/books download ${String(identifier || '').trim()}`;
}

export function formatPaperDownloadCommand(identifier: string): string {
  return `/papers download ${String(identifier || '').trim()}`;
}

export function formatPaperActionCommand(
  action: 'details' | 'citations' | 'references',
  paperId: string,
): string {
  return `/papers ${action} ${String(paperId || '').trim()}`;
}
