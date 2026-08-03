/**
 * Streaming claim-verifier completion — used by manual /review and Auto-review.
 * Tokens are forwarded as they arrive (typically into Thought/reasoning SSE);
 * the accumulated text is returned for JSON parse when the stream ends.
 */

import { runPlainCompletionStream } from '@/lib/chat/server/plain-completion';
import { withTimeout } from '@/lib/chat/server/upstream';
import type { LlmCompleteFn } from '@/lib/tools/review/core/types';

export function createStreamingVerifierComplete(opts: {
  apiKey: string;
  baseURL: string;
  model: string;
  signal?: AbortSignal;
  timeoutMs: number;
  /** Called for each content/reasoning chunk from the verifier model. */
  onDelta?: (chunk: string) => void;
}): LlmCompleteFn {
  return async (messages) => {
    // Many models emit overlapping audit prose on BOTH reasoning and content.
    // Forwarding both into Thought doubles / stutters the panel. Prefer the
    // reasoning channel when present; only mirror content when reasoning is empty.
    let reasoningChars = 0;
    const result = await withTimeout(
      runPlainCompletionStream({
        apiKey: opts.apiKey,
        baseURL: opts.baseURL,
        signal: opts.signal,
        model: opts.model,
        temperature: 0,
        messages,
        checkAbortedEachChunk: true,
        onReasoning: (text) => {
          reasoningChars += text.length;
          opts.onDelta?.(text);
        },
        onContent: (text) => {
          if (reasoningChars === 0) opts.onDelta?.(text);
        },
      }),
      opts.timeoutMs,
      'claim verifier',
    );
    const content = String(result.content || '').trim();
    if (content) return content;
    return String(result.reasoning || '').trim();
  };
}
