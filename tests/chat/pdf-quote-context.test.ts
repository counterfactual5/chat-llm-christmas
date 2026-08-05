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
});
