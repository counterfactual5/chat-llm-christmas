import { describe, expect, it } from 'vitest';
import { buildHistoryToolCalls } from '@/lib/chat/message/tool-receipt';
import type { MessageToolRun } from '@/lib/chat/types';

function run(partial: Partial<MessageToolRun> & { name: string }): MessageToolRun {
  return {
    id: partial.id || 'tr1',
    name: partial.name,
    status: 'done',
    query: partial.query,
    provider: partial.provider,
    results: partial.results,
    error: partial.error,
  };
}

describe('buildHistoryToolCalls', () => {
  it('replays web_read with url, not query', () => {
    const calls = buildHistoryToolCalls(
      [run({ name: 'web_read', query: 'https://example.com/a' })],
      'msg1',
    );
    expect(JSON.parse(calls[0]!.function.arguments)).toEqual({
      url: 'https://example.com/a',
    });
  });

  it('replays web_search with query', () => {
    const calls = buildHistoryToolCalls(
      [run({ name: 'web_search', query: 'esim china' })],
      'msg1',
    );
    expect(JSON.parse(calls[0]!.function.arguments)).toEqual({
      query: 'esim china',
    });
  });
});
