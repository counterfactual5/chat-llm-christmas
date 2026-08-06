/** Max quoted selection chips that can ride along with one send. */
export const MAX_QUOTED_SELECTIONS = 8;

/** Same-page context pad (characters) around a PDF selection. */
export const PDF_QUOTE_CONTEXT_CHARS = 160;

export type QuotedFileSource = {
  kind?: 'pdf' | 'url' | 'epub';
  fileId?: string;
  name?: string;
  /** Absolute http(s) URL for webpage extract quotes. */
  url?: string;
  /** 1-based PDF page (or synthetic page for PPTX later). */
  page?: number;
  /** EPUB CFI locator (epubjs). */
  cfi?: string;
  /** Same-page/root text before the selection (not including the selection). */
  before?: string;
  /** Same-page/root text after the selection. */
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
    s?.kind || '',
    s?.fileId || '',
    s?.url || '',
    s?.cfi || '',
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

/** Build a file/url quote from DOM selection (PDF text layer, URL extract, EPUB). */
export function quotedSelectionFromDom(
  selectedText: string,
  anchorNode: Node | null,
): QuotedSelection {
  const text = String(selectedText || '').trim();
  const base: QuotedSelection = { text };
  if (!text || !anchorNode) return base;

  const el =
    // ELEMENT_NODE === 1
    (anchorNode as { nodeType?: number }).nodeType === 1
      ? (anchorNode as Element)
      : (anchorNode as { parentElement?: Element | null }).parentElement;
  if (!el?.closest) return base;

  // Selection may live inside a same-origin iframe (EPUB); quote attrs sit on the host.
  const hostCandidates: Element[] = [];
  const pushHost = (node: Element | null | undefined) => {
    if (
      node &&
      typeof (node as Element).closest === 'function' &&
      typeof (node as Element).getAttribute === 'function' &&
      !hostCandidates.includes(node)
    ) {
      hostCandidates.push(node);
    }
  };
  pushHost(el);
  try {
    const frame = el.ownerDocument?.defaultView?.frameElement as Element | null;
    if (frame) {
      pushHost(frame);
      pushHost(
        frame.closest(
          '[data-quote-url], [data-quote-kind], [data-quote-cfi], [data-quote-file-id], [data-page]',
        ),
      );
    }
  } catch {
    /* cross-origin frameElement */
  }

  for (const host of hostCandidates) {
    const urlRoot = host.closest('[data-quote-url]');
    if (urlRoot) {
      const url = String(urlRoot.getAttribute('data-quote-url') || '').trim();
      const name = String(urlRoot.getAttribute('data-quote-title') || '').trim();
      const rootText = String(urlRoot.textContent || '');
      const { before, after } = padAroundSelection(rootText, text);
      return {
        text,
        source: {
          kind: 'url',
          url: url || undefined,
          name: name || undefined,
          before: before || undefined,
          after: after || undefined,
        },
      };
    }
  }

  for (const host of hostCandidates) {
    const epubRoot = host.closest(
      '[data-quote-kind="epub"], [data-quote-cfi]',
    );
    if (!epubRoot) continue;
    const fileId = String(
      epubRoot.getAttribute('data-quote-file-id') || '',
    ).trim();
    const name = String(
      epubRoot.getAttribute('data-quote-file-name') || '',
    ).trim();
    const cfi = String(epubRoot.getAttribute('data-quote-cfi') || '').trim();
    // Prefer chapter text from the iframe document when available.
    const chapterText = String(el.ownerDocument?.body?.textContent || '');
    const { before, after } = padAroundSelection(
      chapterText || String(epubRoot.textContent || ''),
      text,
    );
    return {
      text,
      source: {
        kind: 'epub',
        fileId: fileId || undefined,
        name: name || undefined,
        cfi: cfi || undefined,
        before: before || undefined,
        after: after || undefined,
      },
    };
  }

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
  if (!src) return text;

  const before = String(src.before || '').trim();
  const after = String(src.after || '').trim();
  const body =
    before || after
      ? `${before ? `…${before}` : ''}【${text}】${after ? `${after}…` : ''}`
      : text;

  if (src.kind === 'url' || src.url) {
    const labelParts = [src.name || '', src.url || ''].filter(Boolean);
    const label = labelParts.join(' · ');
    return [label, body].filter(Boolean).join('\n');
  }

  if (src.kind === 'epub' || src.cfi) {
    const labelParts = [
      src.name || 'EPUB',
      'epub',
      src.fileId ? `fileId:${src.fileId}` : '',
    ].filter(Boolean);
    const label = labelParts.join(' · ');
    const cfiLine = src.cfi ? `cfi:${src.cfi}` : '';
    return [label, cfiLine, body].filter(Boolean).join('\n');
  }

  if (!src.page) return text;

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
  if (!src) return '';
  if (src.kind === 'url' || src.url) {
    return [src.name, src.url].filter(Boolean).join(' · ');
  }
  if (src.kind === 'epub' || src.cfi) {
    return [src.name || 'EPUB', src.cfi ? 'epub' : ''].filter(Boolean).join(' · ');
  }
  if (!src.page) return '';
  return [src.name, `p.${src.page}`].filter(Boolean).join(' · ');
}
