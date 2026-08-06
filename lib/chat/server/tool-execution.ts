/**
 * Stateless helpers used while executing model-requested tools.
 * Kept separate from the streaming tool loop so fallback and failure rules
 * can be reused and tested without an SSE controller.
 */

export type ToolCallInput = {
  name: string;
  arguments: string;
};

/**
 * `web_read` calls from weaker models sometimes omit a URL. Include recent
 * receipts so the registered tool can recover a concrete URL from context.
 */
export function buildToolFallbackQuery(opts: {
  toolCall: ToolCallInput;
  userAsk: string;
  streamedContent: string;
  workingMessages: Array<{ role?: string; content?: unknown }>;
}): string {
  const { toolCall, userAsk, streamedContent, workingMessages } = opts;
  if (!/^web[_-]?read$/i.test(toolCall.name)) {
    return userAsk || streamedContent;
  }

  const history = workingMessages
    .slice(-12)
    .filter((message) => message?.role === 'tool')
    .map((message) => String(message.content || ''))
    .join('\n');
  return [toolCall.arguments, streamedContent, history, userAsk]
    .filter(Boolean)
    .join('\n');
}

/** True when tool-call argument JSON is a complete JSON **object** (OpenAI shape). */
export function toolArgumentsAreComplete(raw: string): boolean {
  const text = String(raw ?? '').trim();
  if (!text) return true;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * Gateways (Minimax / strict OpenAI bridges) reject the whole chat request when
 * any assistant `tool_calls[].function.arguments` is not valid JSON — including
 * mid-stream truncation, concatenated full resends (`{...}{...}`), or a JSON
 * string/array instead of an object.
 * Empty / invalid → `{}` so the next upstream round stays well-formed.
 */
export function normalizeToolCallArguments(raw: string): string {
  const text = String(raw ?? '').trim();
  if (!text) return '{}';
  if (toolArgumentsAreComplete(text)) return text;
  return '{}';
}

/**
 * Merge streamed argument chunks. Providers usually send deltas; some resend a
 * full JSON object each time — appending those yields `{...}{...}` and 400s.
 */
export function mergeToolCallArgumentChunks(prev: string, chunk: string): string {
  const next = String(chunk ?? '');
  if (!next) return String(prev ?? '');
  const prior = String(prev ?? '');
  if (!prior) return next;
  const combined = prior + next;
  if (toolArgumentsAreComplete(combined)) return combined;
  if (toolArgumentsAreComplete(next)) return next;
  return combined;
}

/** Matches the structured and provider-specific failures emitted by tools. */
export function toolResultIndicatesFailure(content: unknown): boolean {
  const payload = String(content || '');
  return (
    /"ok"\s*:\s*false/i.test(payload) ||
    /"error"\s*:\s*"/i.test(payload) ||
    /MCP error|Input validation error|invalid_type/i.test(payload)
  );
}
