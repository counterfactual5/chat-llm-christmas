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

/** Matches the structured and provider-specific failures emitted by tools. */
export function toolResultIndicatesFailure(content: unknown): boolean {
  const payload = String(content || '');
  return (
    /"ok"\s*:\s*false/i.test(payload) ||
    /"error"\s*:\s*"/i.test(payload) ||
    /MCP error|Input validation error|invalid_type/i.test(payload)
  );
}
