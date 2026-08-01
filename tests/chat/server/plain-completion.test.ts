import { beforeEach, describe, expect, it, vi } from 'vitest';

const upstreamMocks = vi.hoisted(() => ({
  streamChatCompletionsRaw: vi.fn(),
}));

vi.mock('@/lib/chat/server/upstream', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat/server/upstream')>(
    '@/lib/chat/server/upstream',
  );
  return {
    ...actual,
    streamChatCompletionsRaw: upstreamMocks.streamChatCompletionsRaw,
  };
});

import { runPlainCompletionStream } from '@/lib/chat/server/plain-completion';

async function* asyncFrom<T>(values: T[]): AsyncGenerator<T> {
  for (const v of values) yield v;
}

describe('runPlainCompletionStream', () => {
  beforeEach(() => {
    upstreamMocks.streamChatCompletionsRaw.mockReset();
  });

  it('accumulates content/reasoning and invokes onContent/onReasoning per chunk', async () => {
    upstreamMocks.streamChatCompletionsRaw.mockReturnValue(
      asyncFrom([
        { choices: [{ delta: { reasoning_content: 'thinking...' } }] },
        { choices: [{ delta: { content: 'Hello ' } }] },
        { choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] },
      ]),
    );

    const contentChunks: string[] = [];
    const reasoningChunks: string[] = [];
    const result = await runPlainCompletionStream({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      temperature: 0.3,
      messages: [{ role: 'user', content: 'hi' }],
      onContent: (t) => contentChunks.push(t),
      onReasoning: (t) => reasoningChunks.push(t),
    });

    expect(contentChunks).toEqual(['Hello ', 'world']);
    expect(reasoningChunks).toEqual(['thinking...']);
    expect(result).toEqual({
      content: 'Hello world',
      reasoning: 'thinking...',
      lastFinishReason: 'stop',
    });
  });

  it('stops at an in-flight abort and skips the trailing flush when checkAbortedEachChunk is set', async () => {
    const controller = new AbortController();
    async function* streamThenAbort() {
      yield { choices: [{ delta: { content: 'first ' } }] };
      controller.abort();
      yield { choices: [{ delta: { content: 'second' } }] };
    }
    upstreamMocks.streamChatCompletionsRaw.mockReturnValue(streamThenAbort());

    const result = await runPlainCompletionStream({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      signal: controller.signal,
      messages: [],
      checkAbortedEachChunk: true,
    });

    expect(result.content).toBe('first ');
  });

  it('does not stop early when checkAbortedEachChunk is unset', async () => {
    const controller = new AbortController();
    async function* streamThenAbort() {
      yield { choices: [{ delta: { content: 'first ' } }] };
      controller.abort();
      yield { choices: [{ delta: { content: 'second' } }] };
    }
    upstreamMocks.streamChatCompletionsRaw.mockReturnValue(streamThenAbort());

    const result = await runPlainCompletionStream({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      signal: controller.signal,
      messages: [],
    });

    expect(result.content).toBe('first second');
  });
});
