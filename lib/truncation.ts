/**
 * Shared truncation signals for chat streams.
 * Prefer provider finish_reason / stream lifecycle over body heuristics.
 */

export const NATURAL_FINISH_REASONS = new Set(['stop', 'end_turn']);

/**
 * Soft client-era reasons that must NOT stick forever in stored messages —
 * they were often false positives (e.g. listing web_search + “不能扫工作区”).
 */
export const SOFT_TRUNCATION_REASONS = new Set([
  'Stopped while trying to use tools',
  'Model tried to use a tool (unsupported here)',
]);

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
export function streamCompletionPayload(finishReason?: string | null): {
  finish_reason: string | null;
  truncated: boolean;
  truncation_reason?: string;
} {
  const fr = finishReason || 'stop';
  const verdict = truncationFromFinishReason(fr);
  return {
    finish_reason: fr,
    truncated: verdict.truncated,
    ...(verdict.reason ? { truncation_reason: verdict.reason } : {}),
  };
}
