import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/chat/server/plain-completion', () => ({
  runPlainCompletionStream: vi.fn(async (opts: {
    onContent?: (t: string) => void;
    onReasoning?: (t: string) => void;
  }) => {
    opts.onContent?.('{"findings":');
    opts.onContent?.('[],"summary":"ok"}');
    return { content: '{"findings":[],"summary":"ok"}', reasoning: '', lastFinishReason: 'stop' };
  }),
}));

import { runPlainCompletionStream } from '@/lib/chat/server/plain-completion';
import { createStreamingVerifierComplete } from '@/lib/chat/server/verifier-complete';

describe('createStreamingVerifierComplete', () => {
  it('streams deltas and returns accumulated verifier JSON', async () => {
    const deltas: string[] = [];
    const complete = createStreamingVerifierComplete({
      apiKey: 'k',
      baseURL: 'https://example.com',
      model: 'm',
      timeoutMs: 5_000,
      onDelta: (chunk) => deltas.push(chunk),
    });
    const text = await complete([{ role: 'user', content: 'audit' }]);
    expect(text).toBe('{"findings":[],"summary":"ok"}');
    expect(deltas.join('')).toBe('{"findings":[],"summary":"ok"}');
    expect(runPlainCompletionStream).toHaveBeenCalled();
  });
});
