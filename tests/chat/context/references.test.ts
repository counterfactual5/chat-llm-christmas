import { describe, expect, it } from 'vitest';
import {
  collectWebSourcesFromMessages,
  webSourcesForThread,
} from '@/lib/chat/context/references';
import type { Message } from '@/lib/chat/types';

function assistantWithSearch(query: string, url: string): Message {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: 'ok',
    timestamp: Date.now(),
    toolRuns: [
      {
        id: 't1',
        name: 'web_search',
        status: 'done',
        provider: 'tavily',
        query,
        results: [{ title: query, url, snippet: 'hit' }],
      },
    ],
  };
}

describe('webSourcesForThread', () => {
  it('rebuilds sources from the retained thread (edit/resend truncate)', () => {
    const old = assistantWithSearch('毛泽东选集 电子书', 'https://example.com/mao');
    const freshUser: Message = {
      id: 'u1',
      role: 'user',
      content: '你能做些什么了',
      timestamp: Date.now(),
    };
    // Pre-edit session still held Material from the discarded turn.
    const staleSession = {
      webSources: collectWebSourcesFromMessages([old]),
      webSourcesCleared: false as const,
    };
    expect(staleSession.webSources).toHaveLength(1);

    // After Save & resend on the first message, only the new user turn remains.
    expect(webSourcesForThread([freshUser], staleSession)).toEqual([]);
  });

  it('respects cleared allowlist against the retained thread', () => {
    const kept = assistantWithSearch('kept', 'https://example.com/kept');
    const dropped = assistantWithSearch('dropped', 'https://example.com/dropped');
    const session = {
      webSources: collectWebSourcesFromMessages([kept]),
      webSourcesCleared: true as const,
    };
    // Thread still has both, but allowlist only has kept → only kept survives.
    expect(webSourcesForThread([kept, dropped], session)).toEqual([
      expect.objectContaining({ url: 'https://example.com/kept' }),
    ]);
    // Truncate away the allowlisted URL → empty.
    expect(webSourcesForThread([dropped], session)).toEqual([]);
  });
});
