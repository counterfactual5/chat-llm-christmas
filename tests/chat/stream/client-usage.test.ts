import { describe, expect, it } from 'vitest';
import { readCompletionUsage } from '@/lib/chat/stream/usage';

describe('client usage parse', () => {
  it('parses finish SSE usage field', () => {
    const parsed = {
      finish_reason: 'stop',
      truncated: false,
      usage: { prompt_tokens: 1500, completion_tokens: 80, total_tokens: 1580 },
    };
    expect(readCompletionUsage(parsed)).toEqual({
      prompt_tokens: 1500,
      completion_tokens: 80,
      total_tokens: 1580,
    });
  });

  it('returns null when finish has no usage', () => {
    expect(readCompletionUsage({ finish_reason: 'stop', truncated: false })).toBeNull();
  });
});
