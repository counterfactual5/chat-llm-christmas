/**
 * Multi-round tool-calling loop that sits between the proactive-search
 * prelude and the final completion pass in `app/api/chat/route.ts`.
 *
 * Pure decision helpers cover the empty-`tool_calls` branch; the
 * orchestrator `runToolRounds` preserves the route's control flow,
 * prompts, and side-effect order via injected callbacks.
 */

import {
  buildCorrectionPrompt,
  buildExecutionRecordFromMessages,
  buildPendingIntentPrompt,
  detectFakedToolNarration,
  detectPendingToolIntent,
  emitMidTurnReview,
  filterSurfacesMissingReceipt,
  type FakedToolSurface,
  type MidTurnCorrection,
  type ReviewIssue,
} from '@/lib/tools/review/claim-reviewer';
import { narratesSearchInsteadOfCalling, sanitizeChatMessages } from '@/lib/chat/server/messages';
import {
  runToolCallStreamRound,
  type ToolCallAccum,
  type ToolRoundResult,
} from '@/lib/chat/server/tool-round';
import {
  buildToolFallbackQuery,
  toolArgumentsAreComplete,
  toolResultIndicatesFailure,
} from '@/lib/chat/server/tool-execution';
import { streamCompletionPayload } from '@/lib/chat/stream/truncation';

export const MAX_TOOL_ROUNDS = 3;
/** Extra rounds when Google / Notion / GitHub write tools are in play. */
export const MAX_TOOL_ROUNDS_INTEGRATIONS = 5;

/**
 * Execute one round's tool_calls in parallel; append role:tool messages in
 * the original call order so the model still sees a stable transcript.
 */
async function executeToolCallsInParallel(opts: {
  toolCalls: ToolCallAccum[];
  streamedContent: string;
  userAsk: string;
  workingMessages: Array<Record<string, unknown>>;
  enabledTools: unknown;
  toolCtx: unknown;
  executeRegisteredTool: RunToolRoundsDeps['executeRegisteredTool'];
  /** When true, skip calls with incomplete JSON args (timeout / truncated stream). */
  skipIncompleteArgs?: boolean;
}): Promise<boolean> {
  const {
    toolCalls,
    streamedContent,
    userAsk,
    workingMessages,
    enabledTools,
    toolCtx,
    executeRegisteredTool,
    skipIncompleteArgs = false,
  } = opts;

  type Slot =
    | { kind: 'skip'; content: string; failed: true }
    | { kind: 'ok'; content: string; failed: boolean }
    | { kind: 'error'; content: string; failed: true };

  const slots = await Promise.all(
    toolCalls.map(async (tc): Promise<Slot> => {
      if (skipIncompleteArgs && !toolArgumentsAreComplete(tc.arguments)) {
        return {
          kind: 'skip',
          failed: true,
          content: JSON.stringify({
            ok: false,
            error:
              'Tool call arguments were truncated mid-stream; not executed.',
            truncated: true,
          }),
        };
      }
      const fallbackQuery = buildToolFallbackQuery({
        toolCall: tc,
        userAsk,
        streamedContent,
        workingMessages: workingMessages as Array<{
          role?: string;
          content?: unknown;
        }>,
      });
      try {
        const baseCtx = toolCtx as {
          send?: (payload: Record<string, unknown>) => void;
          [key: string]: unknown;
        };
        const baseSend = baseCtx?.send;
        const perCallCtx =
          typeof baseSend === 'function'
            ? {
                ...baseCtx,
                send: (payload: Record<string, unknown>) => {
                  const tool = payload?.tool;
                  if (tool && typeof tool === 'object' && !Array.isArray(tool)) {
                    const t = tool as Record<string, unknown>;
                    baseSend({
                      ...payload,
                      tool: t.callId ? tool : { ...t, callId: tc.id },
                    });
                    return;
                  }
                  baseSend(payload);
                },
              }
            : toolCtx;
        const result = await executeRegisteredTool(
          enabledTools,
          {
            name: tc.name,
            callId: tc.id,
            rawArguments: tc.arguments,
            fallbackQuery,
          },
          perCallCtx,
        );
        const payload = String(result.content || '');
        return {
          kind: 'ok',
          content: result.content,
          failed: toolResultIndicatesFailure(payload),
        };
      } catch (err: unknown) {
        return {
          kind: 'error',
          failed: true,
          content: JSON.stringify({
            error: err instanceof Error ? err.message : String(err || 'tool failed'),
          }),
        };
      }
    }),
  );

  let anyFailure = false;
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]!;
    const slot = slots[i]!;
    if (slot.failed) anyFailure = true;
    workingMessages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: slot.content,
    });
  }
  return anyFailure;
}

/** Prompt pushed after a failed tool round when narration arrives without a retry. */
export const TOOL_FAILURE_RECOVERY_PROMPT = [
  'Your previous tool call(s) FAILED — see the tool result error payloads above.',
  'Either emit corrected tool_calls now (e.g. include required fields like page_id),',
  'OR clearly explain the failure and stop. Do not claim the write succeeded.',
  'Do not leave a half-written outline or empty section headings.',
].join(' ');

export type EmptyToolCallsDecision =
  | { kind: 'proactive_search' }
  | { kind: 'pending_intent'; surfaces: FakedToolSurface[] }
  | { kind: 'faked_success'; surfaces: FakedToolSurface[] }
  | { kind: 'break_has_tool_call_deltas' }
  | { kind: 'failure_recovery' }
  | { kind: 'early_done' }
  | { kind: 'break_no_content' };

/**
 * Decide what the empty-`tool_calls` branch should do for one round.
 * Conditions and short-circuit order match the former inline route loop.
 */
export function decideEmptyToolCallsBranch(opts: {
  streamedContent: string;
  hasToolCallDeltas: boolean;
  round: number;
  maxRounds: number;
  cursorModel: boolean;
  searchEnabled: boolean;
  autoReview: boolean;
  lastToolRoundHadFailure: boolean;
  narratesSearchInsteadOfCalling?: (text: string) => boolean;
  detectPending: (text: string) => FakedToolSurface[];
  detectMissingFaked: (text: string) => FakedToolSurface[];
}): EmptyToolCallsDecision {
  const narrates =
    opts.narratesSearchInsteadOfCalling || narratesSearchInsteadOfCalling;
  const { streamedContent, round, maxRounds } = opts;

  // Cursor: narrated "I'll search" with no tool_calls → force real search.
  if (
    opts.cursorModel &&
    opts.searchEnabled &&
    streamedContent &&
    narrates(streamedContent)
  ) {
    return { kind: 'proactive_search' };
  }

  // Announced "I'll fetch/read first" with no tool_calls — force a real call.
  if (streamedContent && round < maxRounds - 1) {
    const pending = opts.detectPending(streamedContent);
    if (pending.length) {
      return { kind: 'pending_intent', surfaces: pending };
    }
  }

  // Claimed a tool success without emitting tool_calls — corrective turn.
  if (opts.autoReview && streamedContent && round < maxRounds - 1) {
    const missing = opts.detectMissingFaked(streamedContent);
    if (missing.length) {
      return { kind: 'faked_success', surfaces: missing };
    }
  }

  // Malformed / aborted tool_calls (deltas without a function name).
  if (opts.hasToolCallDeltas) {
    return { kind: 'break_has_tool_call_deltas' };
  }

  // Only end early when the model already streamed a user-visible answer.
  if (streamedContent.trim()) {
    if (opts.lastToolRoundHadFailure && round < maxRounds - 1) {
      return { kind: 'failure_recovery' };
    }
    return { kind: 'early_done' };
  }

  return { kind: 'break_no_content' };
}

export type ToolRoundsMutableState = {
  usedTools: boolean;
  lastToolRoundHadFailure: boolean;
  midTurnCorrection: MidTurnCorrection | null;
};

export type RunToolRoundsDeps = {
  state: ToolRoundsMutableState;
  maxRounds?: number;
  activeToolDefs: unknown[];
  /** Skip the loop when proactive search (or similar) already used tools. */
  skipIfUsedTools?: boolean;

  apiKey: string;
  baseURL: string;
  signal?: AbortSignal;
  model: string;
  temperature?: number;
  workingMessages: any[];
  enableThinking: boolean;
  reasoningAsContent: boolean;
  idleMs: number;
  maxTotalMs: number;
  /** Optional per-round budget (remaining request wall clock). */
  resolveMaxTotalMs?: () => number;

  cursorModel: boolean;
  searchEnabled: boolean;
  autoReview: boolean;
  authorizedIntegrations: string[];
  skillCreatorOn: boolean;
  autoReviewTurnBoundary: number;
  userAsk: string;
  enabledTools: unknown;
  toolCtx: unknown;

  send: (payload: Record<string, unknown>) => void;
  closeStreamDone: () => void;
  runProactiveSearch: () => Promise<boolean>;
  postAudit: (
    text: string,
    phase: 'audit',
    meta?: { finishReason?: string | null; truncated?: boolean },
  ) => Promise<{ issues: ReviewIssue[] }>;
  streamReviewCorrection: (
    issues: ReviewIssue[],
    priorText: string,
  ) => Promise<unknown>;
  actionableReviewIssues: (issues: ReviewIssue[]) => ReviewIssue[];
  executeRegisteredTool: (
    enabledTools: any,
    call: {
      name: string;
      callId: string;
      rawArguments: string;
      fallbackQuery: string;
    },
    toolCtx: any,
  ) => Promise<{ content: string }>;
  runRound?: (opts: Parameters<typeof runToolCallStreamRound>[0]) => Promise<ToolRoundResult>;
};

export type RunToolRoundsResult =
  | { status: 'continue' }
  | { status: 'stream_closed' };

/**
 * Run up to `maxRounds` tool-calling rounds. Mutates `deps.state` and
 * `deps.workingMessages` in place. Returns `stream_closed` when the SSE
 * response was already finished (early DONE or failed proactive search).
 */
export async function runToolRounds(
  deps: RunToolRoundsDeps,
): Promise<RunToolRoundsResult> {
  const maxRounds = deps.maxRounds ?? MAX_TOOL_ROUNDS;
  const skipIfUsedTools = deps.skipIfUsedTools !== false;
  if (deps.activeToolDefs.length === 0) return { status: 'continue' };
  if (skipIfUsedTools && deps.state.usedTools) return { status: 'continue' };

  const runRound = deps.runRound || runToolCallStreamRound;

  for (let round = 0; round < maxRounds; round++) {
    const roundBudget = deps.resolveMaxTotalMs?.() ?? deps.maxTotalMs;
    const roundResult = await runRound({
      apiKey: deps.apiKey,
      baseURL: deps.baseURL,
      signal: deps.signal,
      model: deps.model,
      temperature: deps.temperature,
      messages: sanitizeChatMessages(deps.workingMessages),
      tools: deps.activeToolDefs,
      enableThinking: deps.enableThinking,
      reasoningAsContent: deps.reasoningAsContent,
      idleMs: deps.idleMs,
      maxTotalMs: roundBudget,
      send: deps.send,
    });
    if (!roundResult.ok) {
      if (roundResult.truncated) {
        const { streamedContent, toolCalls } = roundResult;
        // Preserve what the user already saw / what tool deltas we collected so
        // the final completion does not contradict the live stream.
        if (toolCalls.length) {
          deps.state.usedTools = true;
          deps.workingMessages.push({
            role: 'assistant',
            content: streamedContent || null,
            tool_calls: toolCalls.map((tc: ToolCallAccum) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments },
            })),
          });
          let roundHadToolFailure = false;
          const failed = await executeToolCallsInParallel({
            toolCalls,
            streamedContent,
            userAsk: deps.userAsk,
            workingMessages: deps.workingMessages,
            enabledTools: deps.enabledTools,
            toolCtx: deps.toolCtx,
            executeRegisteredTool: deps.executeRegisteredTool,
            skipIncompleteArgs: true,
          });
          if (failed) roundHadToolFailure = true;
          if (roundHadToolFailure) deps.state.lastToolRoundHadFailure = true;
        } else if (streamedContent) {
          deps.workingMessages.push({
            role: 'assistant',
            content: streamedContent,
          });
        }
        deps.workingMessages.push({
          role: 'user',
          content: [
            'The previous tool-calling round timed out or hit the stream budget.',
            'Finish the answer using ONLY content and tool results already above.',
            'Do not claim unfinished tool calls succeeded. Do not call tools.',
          ].join(' '),
        });
        deps.send({
          // Do not dump the timeout into answer content — Continue / Process UI
          // surfaces tools_timeout via streamCompletionPayload instead.
          ...streamCompletionPayload('length', { code: 'tools_timeout' }),
        });
      }
      break;
    }
    const { streamedContent, toolCalls, roundFinishReason, hasToolCallDeltas } =
      roundResult;

    if (!toolCalls.length) {
      const decision = decideEmptyToolCallsBranch({
        streamedContent,
        hasToolCallDeltas,
        round,
        maxRounds,
        cursorModel: deps.cursorModel,
        searchEnabled: deps.searchEnabled,
        autoReview: deps.autoReview,
        lastToolRoundHadFailure: deps.state.lastToolRoundHadFailure,
        detectPending: (text) =>
          detectPendingToolIntent(text, {
            searchEnabled: deps.searchEnabled,
            integrations: deps.authorizedIntegrations,
          }),
        detectMissingFaked: (text) => {
          const faked = detectFakedToolNarration(text, {
            searchEnabled: deps.searchEnabled,
            integrations: deps.authorizedIntegrations,
            skillCreator: deps.skillCreatorOn,
          });
          const turnRecord = buildExecutionRecordFromMessages(deps.workingMessages, {
            afterIndex: deps.autoReviewTurnBoundary,
          });
          return filterSurfacesMissingReceipt(faked, turnRecord);
        },
      });

      switch (decision.kind) {
        case 'proactive_search': {
          if (!(await deps.runProactiveSearch())) return { status: 'stream_closed' };
          break;
        }
        case 'pending_intent': {
          deps.state.midTurnCorrection = {
            surfaces: decision.surfaces,
            kind: 'intent',
          };
          emitMidTurnReview(deps.send, deps.state.midTurnCorrection);
          deps.workingMessages.push({
            role: 'assistant',
            content: streamedContent,
          });
          deps.workingMessages.push({
            role: 'user',
            content: buildPendingIntentPrompt(decision.surfaces),
          });
          break;
        }
        case 'faked_success': {
          deps.state.midTurnCorrection = {
            surfaces: decision.surfaces,
            kind: 'success',
          };
          emitMidTurnReview(deps.send, deps.state.midTurnCorrection);
          deps.workingMessages.push({
            role: 'assistant',
            content: streamedContent,
          });
          deps.workingMessages.push({
            role: 'user',
            content: buildCorrectionPrompt(decision.surfaces),
          });
          break;
        }
        case 'break_has_tool_call_deltas':
        case 'break_no_content':
          break;
        case 'failure_recovery': {
          deps.workingMessages.push({
            role: 'assistant',
            content: streamedContent,
          });
          deps.workingMessages.push({
            role: 'user',
            content: TOOL_FAILURE_RECOVERY_PROMPT,
          });
          deps.state.lastToolRoundHadFailure = false;
          break;
        }
        case 'early_done': {
          if (deps.autoReview) {
            const audit = await deps.postAudit(streamedContent, 'audit', {
              finishReason: roundFinishReason,
              truncated: roundFinishReason === 'length',
            });
            const actionable = deps.actionableReviewIssues(audit.issues);
            if (actionable.length) {
              await deps.streamReviewCorrection(actionable, streamedContent);
            }
          }
          deps.send(streamCompletionPayload(roundFinishReason || 'stop'));
          deps.closeStreamDone();
          return { status: 'stream_closed' };
        }
      }
      // All empty-tool_calls decisions end the for-loop (break), matching
      // the former route: every branch either `break`s or `return`s.
      break;
    }

    // Tool calls present — any narration already landed in the bubble as content.
    deps.state.usedTools = true;
    deps.workingMessages.push({
      role: 'assistant',
      content: streamedContent || null,
      tool_calls: toolCalls.map((tc: ToolCallAccum) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    const roundHadToolFailure = await executeToolCallsInParallel({
      toolCalls,
      streamedContent,
      userAsk: deps.userAsk,
      workingMessages: deps.workingMessages,
      enabledTools: deps.enabledTools,
      toolCtx: deps.toolCtx,
      executeRegisteredTool: deps.executeRegisteredTool,
    });
    if (roundHadToolFailure) deps.state.lastToolRoundHadFailure = true;
  }

  return { status: 'continue' };
}
