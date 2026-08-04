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

import { streamFinalCompletion } from '@/lib/chat/server/final-completion';

async function* asyncFrom<T>(values: T[]): AsyncGenerator<T> {
  for (const v of values) yield v;
}

describe('streamFinalCompletion', () => {
  beforeEach(() => {
    upstreamMocks.streamChatCompletionsRaw.mockReset();
  });

  it('reports sawContent + sawText and forwards content/reasoning via send', async () => {
    upstreamMocks.streamChatCompletionsRaw.mockReturnValue(
      asyncFrom([
        { choices: [{ delta: { content: 'Hi ' } }] },
        { choices: [{ delta: { content: 'there' }, finish_reason: 'stop' }] },
      ]),
    );

    const sent: Record<string, unknown>[] = [];
    const result = await streamFinalCompletion({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      temperature: 0.5,
      messages: [],
      enableThinking: false,
      foldReasoning: false,
      idleMs: 5_000,
      maxTotalMs: 30_000,
      send: (payload) => sent.push(payload),
    });

    expect(result).toEqual({
      sawText: true,
      sawContent: true,
      lastFinishReason: 'stop',
      contentBuf: 'Hi there',
      reasoningOnlyBuf: '',
    });
    expect(sent).toEqual([{ content: 'Hi ', reasoning: undefined }, { content: 'there', reasoning: undefined }]);
  });

  it('marks sawText true for reasoning-only output without folding it into content', async () => {
    upstreamMocks.streamChatCompletionsRaw.mockReturnValue(
      asyncFrom([{ choices: [{ delta: { reasoning_content: 'pondering' }, finish_reason: 'stop' }] }]),
    );

    const result = await streamFinalCompletion({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      messages: [],
      enableThinking: false,
      foldReasoning: false,
      idleMs: 5_000,
      maxTotalMs: 30_000,
      send: () => {},
    });

    expect(result.sawText).toBe(true);
    expect(result.sawContent).toBe(false);
    expect(result.contentBuf).toBe('');
    expect(result.reasoningOnlyBuf).toBe('pondering');
  });

  it('reports an empty result when the upstream stream yields nothing', async () => {
    upstreamMocks.streamChatCompletionsRaw.mockReturnValue(asyncFrom([]));

    const result = await streamFinalCompletion({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      messages: [],
      enableThinking: false,
      foldReasoning: false,
      idleMs: 5_000,
      maxTotalMs: 30_000,
      send: () => {},
    });

    expect(result).toEqual({
      sawText: false,
      sawContent: false,
      lastFinishReason: null,
      contentBuf: '',
      reasoningOnlyBuf: '',
    });
  });

  it('keeps partial output when the stream stalls mid-answer', async () => {
    async function* stallAfterPartial() {
      yield { choices: [{ delta: { content: 'partial ' } }] };
      throw new Error('final completion stalled for 90s (no upstream chunks)');
    }
    upstreamMocks.streamChatCompletionsRaw.mockReturnValue(stallAfterPartial());

    const sent: Record<string, unknown>[] = [];
    const result = await streamFinalCompletion({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      messages: [],
      enableThinking: false,
      foldReasoning: false,
      idleMs: 5_000,
      maxTotalMs: 30_000,
      send: (payload) => sent.push(payload),
    });

    expect(result.sawText).toBe(true);
    expect(result.sawContent).toBe(true);
    expect(result.contentBuf).toBe('partial ');
    expect(result.lastFinishReason).toBe('length');
    expect(sent).toEqual([{ content: 'partial ', reasoning: undefined }]);
  });

  it('rethrows a cold stall with no tokens so the caller can retry', async () => {
    async function* coldStall() {
      throw new Error('final completion stalled for 90s (no upstream chunks)');
      yield undefined; // keep as generator
    }
    upstreamMocks.streamChatCompletionsRaw.mockReturnValue(coldStall());

    await expect(
      streamFinalCompletion({
        apiKey: 'k',
        baseURL: 'https://example.test/v1',
        model: 'test-model',
        messages: [],
        enableThinking: false,
        foldReasoning: false,
        idleMs: 5_000,
        maxTotalMs: 30_000,
        send: () => {},
      }),
    ).rejects.toThrow(/stalled for 90s/);
  });
});
