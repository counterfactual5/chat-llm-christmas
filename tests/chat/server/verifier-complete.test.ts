import { describe, expect, it, vi } from 'vitest';

const runPlain = vi.fn();

vi.mock('@/lib/chat/server/plain-completion', () => ({
  runPlainCompletionStream: (opts: unknown) => runPlain(opts),
}));

import { createStreamingVerifierComplete } from '@/lib/chat/server/verifier-complete';

describe('createStreamingVerifierComplete', () => {
  it('streams content deltas when there is no reasoning channel', async () => {
    runPlain.mockImplementation(async (opts: {
      onContent?: (t: string) => void;
      onReasoning?: (t: string) => void;
    }) => {
      opts.onContent?.('{"findings":');
      opts.onContent?.('[],"summary":"ok"}');
      return { content: '{"findings":[],"summary":"ok"}', reasoning: '', lastFinishReason: 'stop' };
    });

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
  });

  it('does not double-stream content into Thought when reasoning is present', async () => {
    runPlain.mockImplementation(async (opts: {
      onContent?: (t: string) => void;
      onReasoning?: (t: string) => void;
    }) => {
      opts.onReasoning?.('Claim A is unsupported. ');
      opts.onReasoning?.('Claim B is unsupported.');
      opts.onContent?.('Claim A is unsupported. Claim B is unsupported.\n{"findings":[]}');
      return {
        content: 'Claim A is unsupported. Claim B is unsupported.\n{"findings":[]}',
        reasoning: 'Claim A is unsupported. Claim B is unsupported.',
        lastFinishReason: 'stop',
      };
    });

    const deltas: string[] = [];
    const complete = createStreamingVerifierComplete({
      apiKey: 'k',
      baseURL: 'https://example.com',
      model: 'm',
      timeoutMs: 5_000,
      onDelta: (chunk) => deltas.push(chunk),
    });
    const text = await complete([{ role: 'user', content: 'audit' }]);
    expect(text).toContain('{"findings":[]}');
    expect(deltas.join('')).toBe(
      'Claim A is unsupported. Claim B is unsupported.',
    );
    expect(deltas.join('')).not.toContain('{"findings"');
  });
});
