/**
 * Shared truncation signals for chat streams.
 * Prefer provider finish_reason / stream lifecycle over body heuristics.
 */

import type { CompletionUsage } from '@/lib/chat/stream/usage';

export const NATURAL_FINISH_REASONS = new Set(['stop', 'end_turn']);

/**
 * Soft client-era reasons that must NOT stick forever in stored messages —
 * they were often false positives (e.g. listing web_search + “不能扫工作区”).
 */
export const SOFT_TRUNCATION_REASONS = new Set([
  'Stopped while trying to use tools',
  'Model tried to use a tool (unsupported here)',
  // Intent narration before mid-turn tools; becomes stale once tools succeed.
  'Stopped before calling tools',
]);

/** Mid-stream tool idle budgets that may be followed by a successful final answer. */
export const RECOVERABLE_TOOL_TIMEOUT_REASON = 'Stream timed out during tool use';

/** Known SSE completion codes — drive Retry vs Continue copy on the client. */
export type StreamCompletionCode =
  | 'tools_timeout'
  | 'upstream_error'
  | 'empty_reply'
  | 'client_abort';

export function actionFromStreamCode(code?: string | null): {
  truncated: boolean;
  reason: string;
  preferRetry: boolean;
} | null {
  switch (String(code || '').trim()) {
    case 'tools_timeout':
      return {
        truncated: true,
        reason: 'Stream timed out during tool use',
        preferRetry: false,
      };
    case 'upstream_error':
      return {
        truncated: false,
        reason: 'Request failed',
        preferRetry: true,
      };
    case 'empty_reply':
      return {
        truncated: false,
        reason: 'Empty reply',
        preferRetry: true,
      };
    case 'client_abort':
      return {
        truncated: true,
        reason: 'Reply was interrupted',
        preferRetry: false,
      };
    default:
      return null;
  }
}

export function truncationFromFinishReason(
  finishReason?: string | null,
): { truncated: boolean; reason: string } {
  if (!finishReason || NATURAL_FINISH_REASONS.has(finishReason)) {
    return { truncated: false, reason: '' };
  }
  if (finishReason === 'length' || finishReason === 'max_tokens') {
    return { truncated: true, reason: 'Hit the output token limit' };
  }
  if (finishReason === 'content_filter') {
    return { truncated: true, reason: 'Blocked by content filter' };
  }
  if (finishReason === 'error') {
    return { truncated: true, reason: 'Request failed' };
  }
  // Final answer stream asked for another tool round we did not execute.
  if (finishReason === 'tool_calls' || finishReason === 'function_call') {
    return { truncated: true, reason: 'Stopped while requesting tools' };
  }
  return { truncated: true, reason: `Stopped early (${finishReason})` };
}

/** Payload fields sent on the last SSE event before [DONE]. */
export function streamCompletionPayload(
  finishReason?: string | null,
  opts?: {
    code?: StreamCompletionCode | string;
    truncationReason?: string;
    usage?: CompletionUsage | null;
  },
): {
  finish_reason: string | null;
  truncated: boolean;
  truncation_reason?: string;
  code?: string;
  usage?: CompletionUsage;
} {
  const fr = finishReason || 'stop';
  const fromCode = actionFromStreamCode(opts?.code);
  const verdict = fromCode
    ? { truncated: fromCode.truncated, reason: fromCode.reason }
    : truncationFromFinishReason(fr);
  const reason = opts?.truncationReason || verdict.reason;
  const usage = opts?.usage || undefined;
  return {
    finish_reason: fr,
    truncated: verdict.truncated,
    ...(reason ? { truncation_reason: reason } : {}),
    ...(opts?.code ? { code: opts.code } : {}),
    ...(usage ? { usage } : {}),
  };
}
