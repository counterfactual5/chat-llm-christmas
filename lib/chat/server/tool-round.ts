/**
 * One round of the model tool-calling loop: stream a completion, accumulate
 * any tool_call deltas alongside visible content/reasoning, and report a
 * structured result. Kept separate from the SSE controller so the round
 * mechanics (budget timeout, stamp stripping, delta merge) are testable and
 * reusable without a live stream.
 */

import { createStampLeakStripper } from '@/lib/chat/context/time-context';
import { boundedAsyncIterator } from '@/lib/chat/server/stream-budget';
import {
  splitCompletionDelta,
  streamChatCompletionsRaw,
} from '@/lib/chat/server/upstream';

export type ToolCallAccum = { id: string; name: string; arguments: string };

export type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

/** Merge one streamed tool_call delta chunk into the per-index accumulator. */
export function applyToolCallDelta(
  deltas: Map<number, ToolCallAccum>,
  tc: ToolCallDelta,
): void {
  const idx = tc.index ?? 0;
  const existing = deltas.get(idx) || { id: '', name: '', arguments: '' };
  if (tc.id) existing.id = tc.id;
  if (tc.function?.name) existing.name += tc.function.name;
  if (tc.function?.arguments) existing.arguments += tc.function.arguments;
  deltas.set(idx, existing);
}

/** Only accumulated calls that resolved a function name are real tool_calls. */
export function collectToolCalls(deltas: Map<number, ToolCallAccum>): ToolCallAccum[] {
  return [...deltas.values()].filter((tc) => tc.name);
}

export type ToolRoundResult = {
  /** false when the upstream stream could not even be created for this round. */
  ok: boolean;
  skipReason?: string;
  /** true when the round hit idle/total budget (not client abort). */
  truncated?: boolean;
  streamedContent: string;
  streamedReasoning: string;
  toolCalls: ToolCallAccum[];
  roundFinishReason: string | null;
  hasToolCallDeltas: boolean;
};

/**
 * Run a single tool-calling round: stream the completion, forward
 * content/reasoning chunks via `send` as they arrive, and accumulate any
 * tool_call deltas. Upstream stream-creation failures are reported via
 * `ok: false` (caller should stop the round loop); mid-stream aborts are
 * soft-failed, returning whatever content/tool_calls were captured so far.
 */
export async function runToolCallStreamRound(opts: {
  apiKey: string;
  baseURL: string;
  signal?: AbortSignal;
  model: string;
  temperature?: number;
  messages: unknown[];
  tools: unknown[];
  enableThinking: boolean;
  reasoningAsContent: boolean;
  idleMs: number;
  maxTotalMs: number;
  roundLabel?: string;
  send: (payload: Record<string, unknown>) => void;
}): Promise<ToolRoundResult> {
  const label = opts.roundLabel || 'tools round';
  let bounded: AsyncGenerator<any>;
  try {
    const raw = streamChatCompletionsRaw({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      signal: opts.signal,
      body: {
        model: opts.model,
        temperature: opts.temperature,
        messages: opts.messages,
        tools: opts.tools,
        tool_choice: 'auto',
        ...(opts.enableThinking ? { enable_thinking: true } : {}),
      },
    });
    bounded = boundedAsyncIterator(raw, {
      idleMs: opts.idleMs,
      maxTotalMs: opts.maxTotalMs,
      label,
    });
  } catch (toolErr: any) {
    console.warn('tools round skipped:', toolErr?.message || toolErr);
    return {
      ok: false,
      skipReason: toolErr?.message || String(toolErr || 'failed'),
      streamedContent: '',
      streamedReasoning: '',
      toolCalls: [],
      roundFinishReason: null,
      hasToolCallDeltas: false,
    };
  }

  let streamedContent = '';
  let streamedReasoning = '';
  const toolCallDeltas = new Map<number, ToolCallAccum>();
  let roundFinishReason: string | null = null;
  let hasToolCallDeltas = false;
  const roundStampStripper = createStampLeakStripper();

  try {
    for await (const chunk of bounded) {
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta || {};
      const finishReason = choice?.finish_reason || null;
      if (finishReason) roundFinishReason = finishReason;

      if (Array.isArray(delta.tool_calls)) {
        hasToolCallDeltas = true;
        for (const tc of delta.tool_calls) applyToolCallDelta(toolCallDeltas, tc);
      }

      const split = splitCompletionDelta(delta, { reasoningAsContent: opts.reasoningAsContent });
      let contentChunk = split.content;
      if (split.reasoning) {
        streamedReasoning += split.reasoning;
        opts.send({ reasoning: split.reasoning });
      }
      if (contentChunk) {
        contentChunk = roundStampStripper.push(contentChunk);
        if (contentChunk) {
          streamedContent += contentChunk;
          opts.send({ content: contentChunk });
        }
      }
    }
  } catch (toolStreamErr: any) {
    // Client abort → soft-fail with whatever we captured.
    // Idle/total budget stall → hard-fail so the caller can surface truncation.
    const msg = toolStreamErr?.message || String(toolStreamErr || 'failed');
    console.warn('tools round stream aborted:', msg);
    const clientAbort =
      Boolean(opts.signal?.aborted) ||
      /aborted|AbortError/i.test(msg);
    const budgetHit = /exceeded|stalled|timed out|budget/i.test(msg);
    {
      const rest = roundStampStripper.flush();
      if (rest) {
        streamedContent += rest;
        opts.send({ content: rest });
      }
    }
    if (!clientAbort && budgetHit) {
      return {
        ok: false,
        skipReason: msg,
        truncated: true,
        streamedContent,
        streamedReasoning,
        toolCalls: collectToolCalls(toolCallDeltas),
        roundFinishReason: roundFinishReason || 'length',
        hasToolCallDeltas,
      };
    }
    return {
      ok: true,
      streamedContent,
      streamedReasoning,
      toolCalls: collectToolCalls(toolCallDeltas),
      roundFinishReason,
      hasToolCallDeltas,
    };
  }
  {
    const rest = roundStampStripper.flush();
    if (rest) {
      streamedContent += rest;
      opts.send({ content: rest });
    }
  }

  return {
    ok: true,
    streamedContent,
    streamedReasoning,
    toolCalls: collectToolCalls(toolCallDeltas),
    roundFinishReason,
    hasToolCallDeltas,
  };
}
