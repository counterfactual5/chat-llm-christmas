/**
 * Un-budgeted, tools-free completion streaming: used for the Request Review
 * dedicated answer and the Auto-review correction pass. Both buffer through
 * the same stamp-leak stripper and content/reasoning split; they differ only
 * in whether they stream chunks live (`onContent`/`onReasoning`) or just
 * collect the final text, and whether an in-flight abort should cut the
 * loop short before the trailing flush.
 */

import { createStampLeakStripper } from '@/lib/chat/context/time-context';
import {
  splitCompletionDelta,
  streamChatCompletionsRaw,
} from '@/lib/chat/server/upstream';

export type PlainCompletionResult = {
  content: string;
  reasoning: string;
  lastFinishReason: string | null;
};

export async function runPlainCompletionStream(opts: {
  apiKey: string;
  baseURL: string;
  signal?: AbortSignal;
  model: string;
  temperature?: number;
  messages: unknown[];
  /** Break the read loop (and skip the trailing flush) once the signal aborts. */
  checkAbortedEachChunk?: boolean;
  onContent?: (text: string) => void;
  onReasoning?: (text: string) => void;
}): Promise<PlainCompletionResult> {
  const stream = streamChatCompletionsRaw({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    signal: opts.signal,
    body: {
      model: opts.model,
      temperature: opts.temperature,
      messages: opts.messages,
    },
  });

  const stampStripper = createStampLeakStripper();
  let content = '';
  let reasoning = '';
  let lastFinishReason: string | null = null;
  let aborted = false;

  for await (const chunk of stream) {
    if (opts.checkAbortedEachChunk && opts.signal?.aborted) {
      aborted = true;
      break;
    }
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    const finish_reason = choice?.finish_reason || null;
    if (finish_reason) lastFinishReason = finish_reason;

    const { content: rawContent, reasoning: r } = splitCompletionDelta(delta, {
      reasoningAsContent: false,
    });
    let c = rawContent;
    if (c) c = stampStripper.push(c);
    if (finish_reason) {
      const rest = stampStripper.flush();
      if (rest) c = (c || '') + rest;
    }
    if (c) {
      content += c;
      opts.onContent?.(c);
    }
    if (r) {
      reasoning += r;
      opts.onReasoning?.(r);
    }
  }
  if (!aborted) {
    const rest = stampStripper.flush();
    if (rest) {
      content += rest;
      opts.onContent?.(rest);
    }
  }
  return { content, reasoning, lastFinishReason };
}
