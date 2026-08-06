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

import {
  applyToolCallDelta,
  collectToolCalls,
  runToolCallStreamRound,
  type ToolCallAccum,
} from '@/lib/chat/server/tool-round';

async function* asyncFrom<T>(values: T[]): AsyncGenerator<T> {
  for (const v of values) yield v;
}

describe('applyToolCallDelta / collectToolCalls', () => {
  it('merges streamed name/argument fragments by index', () => {
    const deltas = new Map<number, ToolCallAccum>();
    applyToolCallDelta(deltas, { index: 0, id: 'call_1', function: { name: 'web_', arguments: '{"q' } });
    applyToolCallDelta(deltas, { index: 0, function: { name: 'search', arguments: '":"x"}' } });
    applyToolCallDelta(deltas, { index: 1, id: 'call_2', function: { name: 'web_read' } });

    expect(collectToolCalls(deltas)).toEqual([
      { id: 'call_1', name: 'web_search', arguments: '{"q":"x"}' },
      { id: 'call_2', name: 'web_read', arguments: '{}' },
    ]);
  });

  it('replaces arguments when a provider resends a full JSON object', () => {
    const deltas = new Map<number, ToolCallAccum>();
    applyToolCallDelta(deltas, {
      index: 0,
      id: 'call_1',
      function: { name: 'web_search', arguments: '{"query":"old"}' },
    });
    applyToolCallDelta(deltas, {
      index: 0,
      function: { arguments: '{"query":"new"}' },
    });
    expect(collectToolCalls(deltas)).toEqual([
      { id: 'call_1', name: 'web_search', arguments: '{"query":"new"}' },
    ]);
  });

  it('drops accumulator entries that never resolved a function name', () => {
    const deltas = new Map<number, ToolCallAccum>();
    applyToolCallDelta(deltas, { index: 0, id: 'call_1' });
    expect(collectToolCalls(deltas)).toEqual([]);
  });
});

describe('runToolCallStreamRound', () => {
  beforeEach(() => {
    upstreamMocks.streamChatCompletionsRaw.mockReset();
  });

  it('streams content live and returns tool_calls accumulated across chunks', async () => {
    upstreamMocks.streamChatCompletionsRaw.mockReturnValue(
      asyncFrom([
        { choices: [{ delta: { content: 'Hello ' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'web_search', arguments: '{}' } },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]),
    );

    const sent: Record<string, unknown>[] = [];
    const result = await runToolCallStreamRound({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      temperature: 0.5,
      messages: [],
      tools: [{ type: 'function', function: { name: 'web_search' } }],
      enableThinking: false,
      reasoningAsContent: false,
      idleMs: 5_000,
      maxTotalMs: 30_000,
      send: (payload) => sent.push(payload),
    });

    expect(result.ok).toBe(true);
    expect(result.streamedContent).toBe('Hello ');
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'web_search', arguments: '{}' }]);
    expect(result.roundFinishReason).toBe('tool_calls');
    expect(sent).toEqual([{ content: 'Hello ' }]);
  });

  it('reports ok:false without throwing when the upstream stream cannot be created', async () => {
    upstreamMocks.streamChatCompletionsRaw.mockImplementation(() => {
      throw new Error('gateway unavailable');
    });

    const result = await runToolCallStreamRound({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      messages: [],
      tools: [],
      enableThinking: false,
      reasoningAsContent: false,
      idleMs: 5_000,
      maxTotalMs: 30_000,
      send: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.skipReason).toBe('gateway unavailable');
    expect(result.toolCalls).toEqual([]);
  });

  it('soft-fails mid-stream errors, keeping whatever content/tool_calls already arrived', async () => {
    async function* aborts() {
      yield { choices: [{ delta: { content: 'partial' } }] };
      throw new Error('stream aborted');
    }
    upstreamMocks.streamChatCompletionsRaw.mockReturnValue(aborts());

    const result = await runToolCallStreamRound({
      apiKey: 'k',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      messages: [],
      tools: [],
      enableThinking: false,
      reasoningAsContent: false,
      idleMs: 5_000,
      maxTotalMs: 30_000,
      send: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.streamedContent).toBe('partial');
    expect(result.toolCalls).toEqual([]);
  });
});
