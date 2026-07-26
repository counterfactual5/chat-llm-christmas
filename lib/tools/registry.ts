/**
 * Chat tool registry — single place to declare OpenAI tools and run them.
 * Add MCP later by registering more ChatTool entries; the route loop stays generic.
 */

export type OpenAIToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolRuntimeFlags = {
  searchEnabled: boolean;
};

export type ToolRuntimeContext = {
  userAsk: string;
  /** SSE helper from the chat route. */
  send: (payload: Record<string, unknown>) => void;
};

export type ToolCallInput = {
  callId: string;
  rawArguments: string;
  /** Fallback when the model omits query args (usually last user text). */
  fallbackQuery: string;
};

export type ToolExecuteResult = {
  /** JSON/text content for role:tool message. */
  content: string;
  /** Optional structured data for special callers (e.g. proactive search). */
  data?: unknown;
};

export type ChatTool = {
  name: string;
  definition: OpenAIToolDefinition;
  /** Extra system guidance when this tool is enabled. */
  systemPrompt?: string;
  enabled: (flags: ToolRuntimeFlags) => boolean;
  execute: (input: ToolCallInput, ctx: ToolRuntimeContext) => Promise<ToolExecuteResult>;
};

export function selectTools(registry: ChatTool[], flags: ToolRuntimeFlags): ChatTool[] {
  return registry.filter((tool) => tool.enabled(flags));
}

export function openaiToolDefinitions(tools: ChatTool[]): OpenAIToolDefinition[] {
  return tools.map((t) => t.definition);
}

export function toolSystemPrompt(tools: ChatTool[]): string {
  return tools
    .map((t) => String(t.systemPrompt || '').trim())
    .filter(Boolean)
    .join(' ');
}

export function findTool(tools: ChatTool[], name: string): ChatTool | undefined {
  return tools.find((t) => t.name === name);
}

export async function executeRegisteredTool(
  tools: ChatTool[],
  input: ToolCallInput & { name: string },
  ctx: ToolRuntimeContext,
): Promise<ToolExecuteResult> {
  const tool = findTool(tools, input.name);
  if (!tool) {
    return {
      content: JSON.stringify({ ok: false, error: `Unknown tool: ${input.name}` }),
    };
  }
  return tool.execute(input, ctx);
}
