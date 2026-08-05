/** Max quoted selection chips that can ride along with one send. */
export const MAX_QUOTED_SELECTIONS = 8;

/** Same-page context pad (characters) around a PDF selection. */
export const PDF_QUOTE_CONTEXT_CHARS = 160;

export type QuotedFileSource = {
  kind?: 'pdf';
  fileId?: string;
  name?: string;
  /** 1-based PDF page (or synthetic page for EPUB/PPTX later). */
  page?: number;
  /** Same-page text before the selection (not including the selection). */
  before?: string;
  /** Same-page text after the selection. */
  after?: string;
};

export type QuotedSelection = {
  /** The user-selected snippet (chip primary text). */
  text: string;
  source?: QuotedFileSource;
};

export function normalizeQuotedSelection(
  q: string | QuotedSelection,
): QuotedSelection {
  if (typeof q === 'string') return { text: q };
  return { text: String(q?.text || ''), source: q?.source };
}

export function quotedSelectionKey(q: QuotedSelection): string {
  const s = q.source;
  return [
    s?.fileId || '',
    s?.page != null ? String(s.page) : '',
    q.text.trim(),
  ].join('\0');
}

/**
 * Locate `selected` inside normalized page text and return same-page neighbors.
 * Uses a short-prefix fallback when whitespace differs between DOM and layer.
 */
export function padAroundSelection(
  pageText: string,
  selected: string,
  pad = PDF_QUOTE_CONTEXT_CHARS,
): { before: string; after: string } {
  const page = String(pageText || '')
    .replace(/\s+/g, ' ')
    .trim();
  const sel = String(selected || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!page || !sel) return { before: '', after: '' };

  let idx = page.indexOf(sel);
  let matchLen = sel.length;
  if (idx < 0 && sel.length > 32) {
    const head = sel.slice(0, 32);
    idx = page.indexOf(head);
    matchLen = head.length;
  }
  if (idx < 0) return { before: '', after: '' };

  const end = idx + matchLen;
  const beforeStart = Math.max(0, idx - pad);
  const afterEnd = Math.min(page.length, end + pad);
  return {
    before: page.slice(beforeStart, idx).trim(),
    after: page.slice(end, afterEnd).trim(),
  };
}

/** Build a file quote from DOM selection (PDF text layer under [data-page]). */
export function quotedSelectionFromDom(
  selectedText: string,
  anchorNode: Node | null,
): QuotedSelection {
  const text = String(selectedText || '').trim();
  const base: QuotedSelection = { text };
  if (!text || !anchorNode || typeof Element === 'undefined') return base;

  const el =
    anchorNode.nodeType === Node.ELEMENT_NODE
      ? (anchorNode as Element)
      : anchorNode.parentElement;
  if (!el?.closest) return base;

  const pageEl = el.closest('[data-page]') as HTMLElement | null;
  if (!pageEl) return base;

  const page = Math.floor(Number(pageEl.getAttribute('data-page')));
  if (!(page >= 1)) return base;

  const root = el.closest('[data-quote-file-id], [data-pdf-file-id]') as
    | HTMLElement
    | null;
  const fileId = String(
    root?.getAttribute('data-quote-file-id') ||
      root?.getAttribute('data-pdf-file-id') ||
      '',
  ).trim();
  const name = String(
    root?.getAttribute('data-quote-file-name') ||
      root?.getAttribute('data-pdf-file-name') ||
      '',
  ).trim();

  const layer = pageEl.querySelector('.textLayer');
  const pageText = String(layer?.textContent || pageEl.textContent || '');
  const { before, after } = padAroundSelection(pageText, text);

  return {
    text,
    source: {
      kind: 'pdf',
      fileId: fileId || undefined,
      name: name || undefined,
      page,
      before: before || undefined,
      after: after || undefined,
    },
  };
}

/** Encode one quote for the outbound user message (blockquote body, no leading `>`). */
export function encodeQuotedSelectionBody(q: QuotedSelection): string {
  const text = String(q.text || '').trim();
  if (!text) return '';
  const src = q.source;
  if (!src?.page) return text;

  const page = Math.floor(Number(src.page));
  const labelParts = [
    src.name || 'PDF',
    page >= 1 ? `p.${page}` : '',
    src.fileId ? `fileId:${src.fileId}` : '',
  ].filter(Boolean);
  const label = labelParts.join(' · ');
  // Local contract travels with the quote only — not the always-on system prompt.
  const hint =
    page >= 1
      ? `(use quote first; if more context needed: file_read start_page=${page} max_pages≤2)`
      : '';

  const before = String(src.before || '').trim();
  const after = String(src.after || '').trim();
  const body =
    before || after
      ? `${before ? `…${before}` : ''}【${text}】${after ? `${after}…` : ''}`
      : text;
  return [label, hint, body].filter(Boolean).join('\n');
}

/** Encode one or more quotes as Markdown blockquotes ahead of the user body. */
export function formatQuotedMessage(
  userText: string,
  quotes: string | string[] | QuotedSelection | QuotedSelection[],
): string {
  const rawList = Array.isArray(quotes) ? quotes : [quotes];
  const list = rawList
    .map((q) => encodeQuotedSelectionBody(normalizeQuotedSelection(q)))
    .map((q) => q.trim())
    .filter(Boolean);
  const body = userText.trim();
  if (!list.length) return body;
  const blocks = list
    .map((q) =>
      q
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
    )
    .join('\n\n');
  return body ? `${blocks}\n\n${body}` : blocks;
}

/** Split a sent user message that was built by formatQuotedMessage into quotes + body. */
export function parseQuotedUserMessage(content: string): { quotes: string[]; body: string } {
  const text = String(content || '');
  if (!text.startsWith('>')) return { quotes: [], body: text };
  const lines = text.split('\n');
  const quotes: string[] = [];
  let current: string[] = [];
  let i = 0;

  const flush = () => {
    const q = current.join('\n').trim();
    if (q) quotes.push(q);
    current = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('> ') || line === '>') {
      current.push(line.startsWith('> ') ? line.slice(2) : '');
      continue;
    }
    if (line.trim() === '') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      if (j < lines.length && (lines[j].startsWith('> ') || lines[j] === '>')) {
        flush();
        i = j - 1;
        continue;
      }
      flush();
      i = j;
      break;
    }
    flush();
    break;
  }
  while (i < lines.length && lines[i].trim() === '') i += 1;
  return {
    quotes,
    body: lines.slice(i).join('\n'),
  };
}

/** Append a new quote chip, de-duping and capping at MAX_QUOTED_SELECTIONS. */
export function appendQuotedSelection(
  prev: QuotedSelection[],
  next: string | QuotedSelection,
): QuotedSelection[] {
  const clean = normalizeQuotedSelection(next);
  clean.text = clean.text.trim();
  if (!clean.text) return prev;
  const key = quotedSelectionKey(clean);
  if (prev.some((q) => quotedSelectionKey(q) === key)) return prev;
  if (prev.length >= MAX_QUOTED_SELECTIONS) {
    return [...prev.slice(1), clean];
  }
  return [...prev, clean];
}

/** Chip subtitle for file-located quotes. */
export function quotedSelectionMeta(q: QuotedSelection): string {
  const src = q.source;
  if (!src?.page) return '';
  return [src.name, `p.${src.page}`].filter(Boolean).join(' · ');
}
