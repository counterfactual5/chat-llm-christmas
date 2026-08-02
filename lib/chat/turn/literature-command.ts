/** Dedicated literature search commands: `/papers …`, `/books …`. */

const PAPERS_CMD_RE = /^(?:\/papers|\/paper|\/论文|\/学术)\s+([\s\S]+)$/i;
const BOOKS_CMD_RE = /^(?:\/books|\/book|\/书籍|\/图书)\s+([\s\S]+)$/i;
const BOOKS_DOWNLOAD_RE =
  /^(?:\/books|\/book|\/书籍|\/图书)\s+download\s+((?:libgen:)?[A-Za-z0-9._%-]+|https?:\/\/\S+)\s*$/i;

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
      kind: 'books';
      action: 'search';
      query: string;
      source?: BookSource;
    }
  | { kind: 'books'; action: 'download'; identifier: string };

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

export function parseLiteratureCommand(text: string): LiteratureCommand | null {
  const raw = text.trim();
  const download = raw.match(BOOKS_DOWNLOAD_RE);
  if (download?.[1]?.trim()) {
    return { kind: 'books', action: 'download', identifier: download[1].trim() };
  }

  const papers = raw.match(PAPERS_CMD_RE);
  if (papers?.[1]?.trim()) {
    const rest = papers[1].trim();
    const { head, tail } = splitHead(rest);
    const headLower = head.toLowerCase();

    if (PAPER_ACTIONS.has(headLower) && tail) {
      if (headLower === 'author') {
        return { kind: 'papers', action: 'author', query: tail };
      }
      return {
        kind: 'papers',
        action: headLower as PaperAction,
        query: tail,
        paperId: tail,
      };
    }

    const source = normalizePaperSource(headLower);
    if (source && source !== 'auto' && tail) {
      return { kind: 'papers', action: 'search', query: tail, source };
    }

    return { kind: 'papers', action: 'search', query: rest, source: 'auto' };
  }

  const books = raw.match(BOOKS_CMD_RE);
  if (books?.[1]?.trim()) {
    const rest = books[1].trim();
    const { head, tail } = splitHead(rest);
    const source = normalizeBookSource(head);
    if (source && source !== 'auto' && tail) {
      return { kind: 'books', action: 'search', query: tail, source };
    }
    return { kind: 'books', action: 'search', query: rest, source: 'auto' };
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
