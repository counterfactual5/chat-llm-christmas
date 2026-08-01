/**
 * Final (post tool-round) completion pass: stream the model's closing
 * answer, split content vs reasoning, strip leaked time-stamps, and report
 * whether any user-visible text arrived. Claim Reviewer post-audit stays
 * with the caller — it needs route-local state (autoReview flag, turn
 * boundary) this module doesn't have.
 */

import { createStampLeakStripper } from '@/lib/chat/context/time-context';
import { boundedAsyncIterator } from '@/lib/chat/server/stream-budget';
import {
  splitCompletionDelta,
  streamChatCompletionsRaw,
} from '@/lib/chat/server/upstream';

export type FinalCompletionResult = {
  sawText: boolean;
  sawContent: boolean;
  lastFinishReason: string | null;
  contentBuf: string;
  reasoningOnlyBuf: string;
};

export async function streamFinalCompletion(opts: {
  apiKey: string;
  baseURL: string;
  signal?: AbortSignal;
  model: string;
  temperature?: number;
  messages: unknown[];
  enableThinking: boolean;
  foldReasoning: boolean;
  idleMs: number;
  maxTotalMs: number;
  send: (payload: Record<string, unknown>) => void;
}): Promise<FinalCompletionResult> {
  const finalStream = streamChatCompletionsRaw({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    signal: opts.signal,
    body: {
      model: opts.model,
      temperature: opts.temperature,
      messages: opts.messages,
      ...(opts.enableThinking ? { enable_thinking: true } : {}),
    },
  });

  let sawText = false;
  let sawContent = false;
  let lastFinishReason: string | null = null;
  let contentBuf = '';
  let reasoningOnlyBuf = '';
  const stampStripper = createStampLeakStripper();

  const bounded = boundedAsyncIterator(finalStream, {
    idleMs: opts.idleMs,
    maxTotalMs: opts.maxTotalMs,
    label: 'final completion',
  });
  for await (const chunk of bounded) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    const finish_reason = choice?.finish_reason || null;
    if (finish_reason) lastFinishReason = finish_reason;

    const { content: rawContent, reasoning } = splitCompletionDelta(delta, {
      reasoningAsContent: opts.foldReasoning,
    });
    let content = rawContent;

    if (content) content = stampStripper.push(content);
    if (finish_reason) {
      const rest = stampStripper.flush();
      if (rest) content = (content || '') + rest;
    }

    if (content) {
      sawText = true;
      sawContent = true;
      contentBuf += content;
    }
    if (reasoning) {
      sawText = true;
      reasoningOnlyBuf += reasoning;
    }
    if (content || reasoning) {
      opts.send({
        content: content || undefined,
        reasoning: reasoning || undefined,
      });
    }
  }
  {
    const rest = stampStripper.flush();
    if (rest) {
      sawText = true;
      sawContent = true;
      contentBuf += rest;
      opts.send({ content: rest });
    }
  }
  // If reasoning arrived but no content, do NOT fold server-side. The client
  // promotes orphan reasoning → content at settle time, preserving the
  // proper Process / answer split — this flag just marks the turn non-empty.
  if (!sawContent && reasoningOnlyBuf.trim()) {
    sawText = true;
  }
  return { sawText, sawContent, lastFinishReason, contentBuf, reasoningOnlyBuf };
}
