import { describe, expect, it } from 'vitest';
import {
  readCompletionUsage,
  withIncludeUsage,
} from '@/lib/chat/stream/usage';

describe('completion usage helpers', () => {
  it('reads usage from a chunk', () => {
    expect(
      readCompletionUsage({
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
    ).toEqual({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
  });

  it('returns null when usage absent', () => {
    expect(readCompletionUsage({ choices: [] })).toBeNull();
    expect(readCompletionUsage(null)).toBeNull();
  });

  it('merges stream_options.include_usage', () => {
    expect(withIncludeUsage({ model: 'x' })).toEqual({
      model: 'x',
      stream_options: { include_usage: true },
    });
    expect(
      withIncludeUsage({ model: 'x', stream_options: { include_obfuscation: true } }),
    ).toEqual({
      model: 'x',
      stream_options: { include_obfuscation: true, include_usage: true },
    });
  });
});
