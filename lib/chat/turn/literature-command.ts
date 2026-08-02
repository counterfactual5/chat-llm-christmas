/** Dedicated literature search commands: `/papers …`, `/books …`. */

const PAPERS_CMD_RE = /^(?:\/papers|\/paper|\/论文|\/学术)\s+([\s\S]+)$/i;
const BOOKS_CMD_RE = /^(?:\/books|\/book|\/书籍|\/图书)\s+([\s\S]+)$/i;
const BOOKS_DOWNLOAD_RE =
  /^(?:\/books|\/book|\/书籍|\/图书)\s+download\s+([A-Za-z0-9._%-]+)\s*$/i;

export type LiteratureKind = 'papers' | 'books';

export type LiteratureCommand =
  | { kind: LiteratureKind; query: string; action?: 'search' }
  | { kind: 'books'; action: 'download'; identifier: string };

export function parseLiteratureCommand(text: string): LiteratureCommand | null {
  const raw = text.trim();
  const download = raw.match(BOOKS_DOWNLOAD_RE);
  if (download?.[1]?.trim()) {
    return { kind: 'books', action: 'download', identifier: download[1].trim() };
  }
  const papers = raw.match(PAPERS_CMD_RE);
  if (papers?.[1]?.trim()) {
    return { kind: 'papers', query: papers[1].trim(), action: 'search' };
  }
  const books = raw.match(BOOKS_CMD_RE);
  if (books?.[1]?.trim()) {
    return { kind: 'books', query: books[1].trim(), action: 'search' };
  }
  return null;
}

export function formatLiteratureCommand(kind: LiteratureKind, query: string): string {
  const q = String(query || '').trim();
  return kind === 'books' ? `/books ${q}` : `/papers ${q}`;
}

export function formatBookDownloadCommand(identifier: string): string {
  return `/books download ${String(identifier || '').trim()}`;
}
