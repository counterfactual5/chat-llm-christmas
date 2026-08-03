import { describe, expect, it, vi } from 'vitest';

import {
  decideEmptyToolCallsBranch,
  MAX_TOOL_ROUNDS,
  runToolRounds,
  TOOL_FAILURE_RECOVERY_PROMPT,
  type ToolRoundsMutableState,
} from '@/lib/chat/server/run-tool-rounds';
import type { FakedToolSurface } from '@/lib/tools/review/claim-reviewer';

function baseDecision(
  overrides: Partial<Parameters<typeof decideEmptyToolCallsBranch>[0]> = {},
) {
  return decideEmptyToolCallsBranch({
    streamedContent: '',
    hasToolCallDeltas: false,
    round: 0,
    maxRounds: MAX_TOOL_ROUNDS,
    cursorModel: false,
    searchEnabled: false,
    autoReview: false,
    lastToolRoundHadFailure: false,
    detectPending: () => [],
    detectMissingFaked: () => [],
    ...overrides,
  });
}

describe('decideEmptyToolCallsBranch', () => {
  it('prefers cursor narrated-search over pending intent', () => {
    const detectPending = vi.fn(() => ['web_search'] as FakedToolSurface[]);
    const decision = baseDecision({
      streamedContent: 'Let me search the web now.',
      cursorModel: true,
      searchEnabled: true,
      narratesSearchInsteadOfCalling: () => true,
      detectPending,
    });
    expect(decision).toEqual({ kind: 'proactive_search' });
    expect(detectPending).not.toHaveBeenCalled();
  });

  it('returns pending_intent when surfaces are detected and rounds remain', () => {
    const decision = baseDecision({
      streamedContent: '让我先读取 Notion 页面',
      round: 0,
      detectPending: () => ['notion'],
    });
    expect(decision).toEqual({ kind: 'pending_intent', surfaces: ['notion'] });
  });

  it('skips pending_intent on the last round', () => {
    const detectPending = vi.fn(() => ['notion'] as FakedToolSurface[]);
    const decision = baseDecision({
      streamedContent: '让我先读取',
      round: MAX_TOOL_ROUNDS - 1,
      detectPending,
    });
    expect(detectPending).not.toHaveBeenCalled();
    expect(decision.kind).toBe('early_done');
  });

  it('returns faked_success only when autoReview is on and receipts are missing', () => {
    const decision = baseDecision({
      streamedContent: '我已经更新了 Notion 页面',
      autoReview: true,
      detectMissingFaked: () => ['notion'],
    });
    expect(decision).toEqual({ kind: 'faked_success', surfaces: ['notion'] });
  });

  it('does not check faked success when autoReview is off', () => {
    const detectMissingFaked = vi.fn(() => ['notion'] as FakedToolSurface[]);
    const decision = baseDecision({
      streamedContent: '我已经更新了 Notion 页面',
      autoReview: false,
      detectMissingFaked,
    });
    expect(detectMissingFaked).not.toHaveBeenCalled();
    expect(decision.kind).toBe('early_done');
  });

  it('breaks on malformed tool_call deltas before early_done', () => {
    const decision = baseDecision({
      streamedContent: 'partial',
      hasToolCallDeltas: true,
    });
    expect(decision).toEqual({ kind: 'break_has_tool_call_deltas' });
  });

  it('recovers after a failed tool round when rounds remain', () => {
    const decision = baseDecision({
      streamedContent: 'outline…',
      lastToolRoundHadFailure: true,
      round: 1,
    });
    expect(decision).toEqual({ kind: 'failure_recovery' });
  });

  it('early_done when content exists and no recovery path applies', () => {
    expect(baseDecision({ streamedContent: 'Final answer' }).kind).toBe('early_done');
  });

  it('break_no_content when the model streamed nothing visible', () => {
    expect(baseDecision({ streamedContent: '   ' }).kind).toBe('break_no_content');
  });
});

describe('runToolRounds', () => {
  function makeState(
    overrides: Partial<ToolRoundsMutableState> = {},
  ): ToolRoundsMutableState {
    return {
      usedTools: false,
      lastToolRoundHadFailure: false,
      midTurnCorrection: null,
      ...overrides,
    };
  }

  it('no-ops when tools are empty or already used', async () => {
    const runRound = vi.fn();
    const state = makeState({ usedTools: true });
    const outcome = await runToolRounds({
      state,
      activeToolDefs: [{ type: 'function' }],
      apiKey: 'k',
      baseURL: 'https://example.test',
      model: 'm',
      workingMessages: [],
      enableThinking: false,
      reasoningAsContent: false,
      idleMs: 1000,
      maxTotalMs: 1000,
      cursorModel: false,
      searchEnabled: false,
      autoReview: false,
      authorizedIntegrations: [],
      skillCreatorOn: false,
      autoReviewTurnBoundary: 0,
      userAsk: 'hi',
      enabledTools: [],
      toolCtx: {},
      send: vi.fn(),
      closeStreamDone: vi.fn(),
      runProactiveSearch: vi.fn(),
      postAudit: vi.fn(),
      streamReviewCorrection: vi.fn(),
      actionableReviewIssues: (issues) => issues,
      executeRegisteredTool: vi.fn(),
      runRound,
    });
    expect(outcome).toEqual({ status: 'continue' });
    expect(runRound).not.toHaveBeenCalled();
  });

  it('executes tool_calls and flags round failures', async () => {
    const workingMessages: any[] = [{ role: 'user', content: 'write' }];
    const state = makeState();
    const send = vi.fn();
    const executeRegisteredTool = vi.fn(async () => ({
      content: JSON.stringify({ ok: false, error: 'missing page_id' }),
    }));

    const outcome = await runToolRounds({
      state,
      maxRounds: 1,
      activeToolDefs: [{ type: 'function', function: { name: 'notion_write' } }],
      apiKey: 'k',
      baseURL: 'https://example.test',
      model: 'm',
      workingMessages,
      enableThinking: false,
      reasoningAsContent: false,
      idleMs: 1000,
      maxTotalMs: 1000,
      cursorModel: false,
      searchEnabled: false,
      autoReview: false,
      authorizedIntegrations: ['notion'],
      skillCreatorOn: false,
      autoReviewTurnBoundary: 0,
      userAsk: 'write to notion',
      enabledTools: [],
      toolCtx: {},
      send,
      closeStreamDone: vi.fn(),
      runProactiveSearch: vi.fn(),
      postAudit: vi.fn(),
      streamReviewCorrection: vi.fn(),
      actionableReviewIssues: (issues) => issues,
      executeRegisteredTool,
      runRound: async () => ({
        ok: true,
        streamedContent: 'calling…',
        streamedReasoning: '',
        toolCalls: [{ id: 'c1', name: 'notion_write', arguments: '{}' }],
        roundFinishReason: 'tool_calls',
        hasToolCallDeltas: true,
      }),
    });

    expect(outcome).toEqual({ status: 'continue' });
    expect(state.usedTools).toBe(true);
    expect(state.lastToolRoundHadFailure).toBe(true);
    expect(executeRegisteredTool).toHaveBeenCalledOnce();
    expect(workingMessages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('pushes failure recovery and clears the failure flag', async () => {
    const workingMessages: any[] = [];
    const state = makeState({ lastToolRoundHadFailure: true });

    const outcome = await runToolRounds({
      state,
      activeToolDefs: [{ type: 'function' }],
      apiKey: 'k',
      baseURL: 'https://example.test',
      model: 'm',
      workingMessages,
      enableThinking: false,
      reasoningAsContent: false,
      idleMs: 1000,
      maxTotalMs: 1000,
      cursorModel: false,
      searchEnabled: false,
      autoReview: false,
      authorizedIntegrations: [],
      skillCreatorOn: false,
      autoReviewTurnBoundary: 0,
      userAsk: 'hi',
      enabledTools: [],
      toolCtx: {},
      send: vi.fn(),
      closeStreamDone: vi.fn(),
      runProactiveSearch: vi.fn(),
      postAudit: vi.fn(),
      streamReviewCorrection: vi.fn(),
      actionableReviewIssues: (issues) => issues,
      executeRegisteredTool: vi.fn(),
      runRound: async () => ({
        ok: true,
        streamedContent: 'half outline',
        streamedReasoning: '',
        toolCalls: [],
        roundFinishReason: 'stop',
        hasToolCallDeltas: false,
      }),
    });

    expect(outcome).toEqual({ status: 'continue' });
    expect(state.lastToolRoundHadFailure).toBe(false);
    expect(workingMessages.at(-1)?.content).toBe(TOOL_FAILURE_RECOVERY_PROMPT);
  });

  it('early-dones the stream after soft audit when content arrives without tools', async () => {
    const closeStreamDone = vi.fn();
    const postAudit = vi.fn(async () => ({ issues: [{ id: 'i1' }] as any }));
    const streamReviewCorrection = vi.fn(async () => true);
    const send = vi.fn();
    const state = makeState();

    const outcome = await runToolRounds({
      state,
      activeToolDefs: [{ type: 'function' }],
      apiKey: 'k',
      baseURL: 'https://example.test',
      model: 'm',
      workingMessages: [],
      enableThinking: false,
      reasoningAsContent: false,
      idleMs: 1000,
      maxTotalMs: 1000,
      cursorModel: false,
      searchEnabled: false,
      autoReview: true,
      authorizedIntegrations: [],
      skillCreatorOn: false,
      autoReviewTurnBoundary: 0,
      userAsk: 'hi',
      enabledTools: [],
      toolCtx: {},
      send,
      closeStreamDone,
      runProactiveSearch: vi.fn(),
      postAudit,
      streamReviewCorrection,
      actionableReviewIssues: (issues) => issues,
      executeRegisteredTool: vi.fn(),
      runRound: async () => ({
        ok: true,
        streamedContent: 'Here is the answer.',
        streamedReasoning: '',
        toolCalls: [],
        roundFinishReason: 'stop',
        hasToolCallDeltas: false,
      }),
    });

    expect(outcome).toEqual({ status: 'stream_closed' });
    expect(postAudit).toHaveBeenCalledOnce();
    expect(streamReviewCorrection).toHaveBeenCalledOnce();
    expect(closeStreamDone).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalled();
  });

  it('sets midTurnCorrection for pending intent and stops the loop', async () => {
    const workingMessages: any[] = [];
    const state = makeState();

    const outcome = await runToolRounds({
      state,
      activeToolDefs: [{ type: 'function' }],
      apiKey: 'k',
      baseURL: 'https://example.test',
      model: 'm',
      workingMessages,
      enableThinking: false,
      reasoningAsContent: false,
      idleMs: 1000,
      maxTotalMs: 1000,
      cursorModel: false,
      searchEnabled: true,
      autoReview: false,
      authorizedIntegrations: [],
      skillCreatorOn: false,
      autoReviewTurnBoundary: 0,
      userAsk: 'search x',
      enabledTools: [],
      toolCtx: {},
      send: vi.fn(),
      closeStreamDone: vi.fn(),
      runProactiveSearch: vi.fn(),
      postAudit: vi.fn(),
      streamReviewCorrection: vi.fn(),
      actionableReviewIssues: (issues) => issues,
      executeRegisteredTool: vi.fn(),
      runRound: async () => ({
        ok: true,
        streamedContent: '让我搜索一下最新消息',
        streamedReasoning: '',
        toolCalls: [],
        roundFinishReason: 'stop',
        hasToolCallDeltas: false,
      }),
    });

    expect(outcome).toEqual({ status: 'continue' });
    expect(state.midTurnCorrection?.kind).toBe('intent');
    expect(state.midTurnCorrection?.surfaces).toContain('web_search');
    expect(workingMessages.length).toBe(2);
  });

  it('does not execute truncated incomplete tool arguments on stream timeout', async () => {
    const workingMessages: any[] = [{ role: 'user', content: 'mark unread' }];
    const state = makeState();
    const executeRegisteredTool = vi.fn();
    const send = vi.fn();

    const outcome = await runToolRounds({
      state,
      maxRounds: 1,
      activeToolDefs: [{ type: 'function', function: { name: 'gmail_batch_mark_read' } }],
      apiKey: 'k',
      baseURL: 'https://example.test',
      model: 'm',
      workingMessages,
      enableThinking: false,
      reasoningAsContent: false,
      idleMs: 1000,
      maxTotalMs: 1000,
      cursorModel: false,
      searchEnabled: false,
      autoReview: false,
      authorizedIntegrations: ['gmail'],
      skillCreatorOn: false,
      autoReviewTurnBoundary: 0,
      userAsk: 'mark unread',
      enabledTools: [],
      toolCtx: {},
      send,
      closeStreamDone: vi.fn(),
      runProactiveSearch: vi.fn(),
      postAudit: vi.fn(),
      streamReviewCorrection: vi.fn(),
      actionableReviewIssues: (issues) => issues,
      executeRegisteredTool,
      runRound: async () => ({
        ok: false,
        truncated: true,
        skipReason: 'budget exceeded',
        streamedContent: 'calling…',
        streamedReasoning: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'gmail_batch_mark_read',
            arguments: '{"query":"is:unre',
          },
        ],
      }),
    });

    expect(outcome).toEqual({ status: 'continue' });
    expect(executeRegisteredTool).not.toHaveBeenCalled();
    expect(state.lastToolRoundHadFailure).toBe(true);
    const toolMsg = workingMessages.find((m) => m.role === 'tool');
    expect(String(toolMsg?.content || '')).toMatch(/truncated/i);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'tools_timeout' }),
    );
  });
});
