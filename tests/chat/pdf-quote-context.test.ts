import { describe, expect, it } from 'vitest';
import {
  appendQuotedSelection,
  encodeQuotedSelectionBody,
  formatQuotedMessage,
  padAroundSelection,
  parseQuotedUserMessage,
  quotedSelectionMeta,
} from '@/lib/chat/message/quotes';

describe('padAroundSelection', () => {
  it('returns same-page neighbors around the selection', () => {
    const page =
      'The quick brown fox jumps over the lazy dog near the river bank today.';
    const selected = 'fox jumps over';
    const { before, after } = padAroundSelection(page, selected, 20);
    expect(before).toContain('brown');
    expect(after).toContain('lazy');
    expect(before).not.toContain('fox');
    expect(after).not.toContain('fox');
  });

  it('falls back to a short prefix when whitespace differs', () => {
    const page = 'Alpha beta gamma delta epsilon zeta';
    const selected = 'beta   gamma   delta';
    const { before, after } = padAroundSelection(page, selected, 40);
    // Normalized match should still find neighbors.
    expect(before.length + after.length).toBeGreaterThan(0);
  });
});

describe('encodeQuotedSelectionBody / formatQuotedMessage', () => {
  it('keeps plain chat quotes as text only', () => {
    expect(encodeQuotedSelectionBody({ text: 'hello' })).toBe('hello');
    expect(formatQuotedMessage('why?', [{ text: 'hello' }])).toBe(
      '> hello\n\nwhy?',
    );
  });

  it('embeds page locator and same-page context for PDF quotes', () => {
    const body = encodeQuotedSelectionBody({
      text: 'causal effect',
      source: {
        kind: 'pdf',
        name: 'paper.pdf',
        fileId: 'file-1',
        page: 12,
        before: 'estimate the',
        after: 'of treatment',
      },
    });
    expect(body).toContain('paper.pdf · p.12 · fileId:file-1');
    expect(body).toContain(
      '(use quote first; if more context needed: file_read start_page=12 max_pages≤2)',
    );
    expect(body).toContain('…estimate the【causal effect】of treatment…');

    const msg = formatQuotedMessage('explain', [
      {
        text: 'causal effect',
        source: {
          name: 'paper.pdf',
          page: 12,
          before: 'estimate the',
          after: 'of treatment',
        },
      },
    ]);
    expect(msg.startsWith('> ')).toBe(true);
    expect(msg).toContain('p.12');
    expect(msg).toContain('max_pages≤2');
    expect(msg).toContain('explain');
    const parsed = parseQuotedUserMessage(msg);
    expect(parsed.body).toBe('explain');
    expect(parsed.quotes[0]).toContain('【causal effect】');
  });
  it('embeds URL identity for webpage extract quotes', () => {
    const body = encodeQuotedSelectionBody({
      text: 'cited line',
      source: {
        kind: 'url',
        name: 'Example',
        url: 'https://example.com/a',
        before: 'lead',
        after: 'trail',
      },
    });
    expect(body).toContain('Example · https://example.com/a');
    expect(body).toContain('…lead【cited line】trail…');
    expect(body).not.toContain('file_read');
  });

  it('embeds EPUB CFI without PDF file_read hints', () => {
    const body = encodeQuotedSelectionBody({
      text: 'chapter text',
      source: {
        kind: 'epub',
        name: 'Book.epub',
        fileId: 'f-epub',
        cfi: 'epubcfi(/6/2)',
      },
    });
    expect(body).toContain('Book.epub · epub · fileId:f-epub');
    expect(body).toContain('cfi:epubcfi(/6/2)');
    expect(body).toContain('chapter text');
    expect(body).not.toContain('start_page');
  });
});

describe('appendQuotedSelection / meta', () => {
  it('dedupes by fileId+page+text and shows chip meta', () => {
    const a = {
      text: 'hello',
      source: { name: 'a.pdf', page: 2, fileId: 'f1' },
    };
    let list = appendQuotedSelection([], a);
    list = appendQuotedSelection(list, a);
    expect(list).toHaveLength(1);
    expect(quotedSelectionMeta(a)).toBe('a.pdf · p.2');
  });

  it('shows URL and EPUB chip meta', () => {
    expect(
      quotedSelectionMeta({
        text: 'x',
        source: { kind: 'url', name: 'T', url: 'https://x.test' },
      }),
    ).toBe('T · https://x.test');
    expect(
      quotedSelectionMeta({
        text: 'x',
        source: { kind: 'epub', name: 'B', cfi: 'epubcfi(/6/2)' },
      }),
    ).toBe('B · epub');
  });
});

describe('quotedSelectionFromDom (attr hosts)', () => {
  it('builds URL source from data-quote-url host', async () => {
    const { quotedSelectionFromDom } = await import('@/lib/chat/message/quotes');
    const host = {
      nodeType: 1,
      getAttribute: (k: string) =>
        k === 'data-quote-url'
          ? 'https://example.com/p'
          : k === 'data-quote-title'
            ? 'Page'
            : null,
      textContent: 'aa selected bb',
      closest: (sel: string) => (sel.includes('data-quote-url') ? host : null),
      ownerDocument: { defaultView: null, body: null },
    } as unknown as Element;
    const quote = quotedSelectionFromDom('selected', host);
    expect(quote.source?.kind).toBe('url');
    expect(quote.source?.url).toBe('https://example.com/p');
    expect(quote.source?.name).toBe('Page');
  });

  it('builds EPUB source from data-quote-kind host', async () => {
    const { quotedSelectionFromDom } = await import('@/lib/chat/message/quotes');
    const host = {
      nodeType: 1,
      getAttribute: (k: string) => {
        if (k === 'data-quote-kind') return 'epub';
        if (k === 'data-quote-file-id') return 'book-1';
        if (k === 'data-quote-file-name') return 'Novel.epub';
        if (k === 'data-quote-cfi') return 'epubcfi(/6/4)';
        return null;
      },
      textContent: 'Once upon a time',
      closest: (sel: string) =>
        sel.includes('epub') || sel.includes('cfi') ? host : null,
      ownerDocument: {
        defaultView: null,
        body: { textContent: 'Once upon a time' },
      },
    } as unknown as Element;
    const quote = quotedSelectionFromDom('upon a', host);
    expect(quote.source?.kind).toBe('epub');
    expect(quote.source?.fileId).toBe('book-1');
    expect(quote.source?.cfi).toBe('epubcfi(/6/4)');
  });
});
