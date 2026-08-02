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
  /**
   * Per-chat MCP / OAuth integrations the user turned on for this request
   * (e.g. `notion`). Empty ⇒ no MCP tools or MCP guidance enter the context.
   */
  integrations: string[];
};

export type ToolRuntimeContext = {
  userAsk: string;
  /** SSE helper from the chat route. */
  send: (payload: Record<string, unknown>) => void;
  /** Per-request OAuth tokens for enabled integrations. */
  credentials?: {
    notionAccessToken?: string;
    githubAccessToken?: string;
    googleAccessToken?: string;
    /** Bound main-site key for account-scoped writes (e.g. save_skill). */
    skillsApiKey?: string;
  };
  /** Active skills payload from the request (Skill Creator detection). */
  requestSkills?: Array<{ id?: string; title?: string; content?: string }>;
  /** CPA gateway details so tools can make their own LLM calls. */
  gateway?: {
    apiKey: string;
    baseURL: string;
  };
  /**
   * Extracted text for attached docs in this thread (fileId → body).
   * Built before history collapse so file_read can re-materialize full text.
   */
  fileExtracts?: Record<string, { name?: string; text: string }>;
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
  return [
    ...new Set(
      tools
        .map((t) => String(t.systemPrompt || '').trim())
        .filter(Boolean),
    ),
  ].join(' ');
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
