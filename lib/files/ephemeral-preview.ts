/**
 * Shared ephemeral literature Preview helpers (paper / future book).
 * Content is served via same-origin `/api/literature/<kind>/content` — does not write Files.
 */

export type EphemeralPreviewKind = 'paper' | 'book';

const KIND_PREFIX: Record<EphemeralPreviewKind, string> = {
  paper: 'paper-preview:',
  book: 'book-preview:',
};

const KIND_MESSAGE_ID: Record<EphemeralPreviewKind, string> = {
  paper: 'url-preview-paper',
  book: 'url-preview-book',
};

const KIND_CONTENT_PATH: Record<EphemeralPreviewKind, string> = {
  paper: '/api/literature/papers/content',
  book: '/api/literature/books/content',
};

export function literatureContentUrl(
  kind: EphemeralPreviewKind,
  identifier: string,
): string {
  const id = String(identifier || '').trim();
  return `${KIND_CONTENT_PATH[kind]}?identifier=${encodeURIComponent(id)}`;
}

export function isEphemeralPreviewId(
  id: string,
  kind?: EphemeralPreviewKind,
): boolean {
  const raw = String(id || '');
  if (kind) return raw.startsWith(KIND_PREFIX[kind]);
  return raw.startsWith('paper-preview:') || raw.startsWith('book-preview:');
}

export function identifierFromContentUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, 'http://local.invalid');
    return String(u.searchParams.get('identifier') || '').trim();
  } catch {
    return '';
  }
}

/** Decode identifier from `paper-preview:` / `book-preview:` entry id. */
export function identifierFromEphemeralPreviewId(
  id: string,
  kind: EphemeralPreviewKind,
): string {
  const raw = String(id || '');
  const prefix = KIND_PREFIX[kind];
  if (!raw.startsWith(prefix)) return '';
  try {
    return decodeURIComponent(raw.slice(prefix.length));
  } catch {
    return raw.slice(prefix.length);
  }
}

export function kindFromEphemeralPreviewId(
  id: string,
): EphemeralPreviewKind | null {
  if (isEphemeralPreviewId(id, 'paper')) return 'paper';
  if (isEphemeralPreviewId(id, 'book')) return 'book';
  return null;
}

export type EphemeralPreviewEntry = {
  messageId: string;
  fileIndex: number;
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: number;
};

export function ephemeralPreviewEntry(opts: {
  kind: EphemeralPreviewKind;
  identifier: string;
  title?: string;
  filename?: string;
  mimeType?: string;
}): EphemeralPreviewEntry {
  const kind = opts.kind;
  const identifier = String(opts.identifier || '').trim();
  const fallbackName = kind === 'book' ? 'book' : 'paper';
  const title = String(opts.title || fallbackName).trim() || fallbackName;
  const defaultExt = kind === 'book' ? 'epub' : 'pdf';
  const defaultMime =
    kind === 'book' ? 'application/epub+zip' : 'application/pdf';
  const filename =
    String(opts.filename || '').trim() ||
    `${title.replace(/[^\w\u4e00-\u9fff\-]+/g, '_').slice(0, 80) || fallbackName}.${defaultExt}`;
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(filename);
  return {
    messageId: KIND_MESSAGE_ID[kind],
    fileIndex: 0,
    id: `${KIND_PREFIX[kind]}${encodeURIComponent(identifier).slice(0, 180)}`,
    name: hasExt ? filename : `${filename}.${defaultExt}`,
    mimeType: opts.mimeType || defaultMime,
    size: 0,
    url: literatureContentUrl(kind, identifier),
    createdAt: Date.now(),
  };
}

/** Map opaque upstream errors to a stable CTA body. */
export function friendlyLiteraturePreviewMessage(
  raw: string | undefined,
  fallback: string,
): string {
  const msg = String(raw || '').trim();
  if (!msg) return fallback;
  const lower = msg.toLowerCase();
  if (
    lower === 'internal error' ||
    lower.includes('semantic scholar http') ||
    lower.includes('download returned html') ||
    lower.includes('no open-access pdf') ||
    lower.includes('not_pdf') ||
    lower.includes('download_html') ||
    lower.includes('no downloadable')
  ) {
    return fallback;
  }
  return msg;
}

export function paperPreviewContentUrl(identifier: string): string {
  return literatureContentUrl('paper', identifier);
}

export function isEphemeralPaperPreviewId(id: string): boolean {
  return isEphemeralPreviewId(id, 'paper');
}

export function paperIdentifierFromContentUrl(url: string): string {
  return identifierFromContentUrl(url);
}

export function ephemeralPaperPreviewEntry(opts: {
  identifier: string;
  title?: string;
  filename?: string;
}): EphemeralPreviewEntry {
  return ephemeralPreviewEntry({
    kind: 'paper',
    ...opts,
    mimeType: 'application/pdf',
  });
}
