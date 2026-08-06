/**
 * OpenAI-compatible completion usage (gateway-reported token counts).
 */

export type CompletionUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export function readCompletionUsage(chunk: unknown): CompletionUsage | null {
  const raw = (chunk as { usage?: unknown } | null)?.usage;
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const prompt = numOrUndef(u.prompt_tokens);
  const completion = numOrUndef(u.completion_tokens);
  const total = numOrUndef(u.total_tokens);
  if (prompt == null && completion == null && total == null) return null;
  return {
    ...(prompt != null ? { prompt_tokens: prompt } : {}),
    ...(completion != null ? { completion_tokens: completion } : {}),
    ...(total != null ? { total_tokens: total } : {}),
  };
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Merge stream_options.include_usage into a chat.completions body. */
export function withIncludeUsage(body: Record<string, unknown>): Record<string, unknown> {
  const prev =
    body.stream_options && typeof body.stream_options === 'object'
      ? (body.stream_options as Record<string, unknown>)
      : {};
  return {
    ...body,
    stream_options: { ...prev, include_usage: true },
  };
}
