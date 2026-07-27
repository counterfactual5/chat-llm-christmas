import type { ChatTool, ToolRuntimeFlags } from '@/lib/tools/registry';
import { selectTools } from '@/lib/tools/registry';
import { createWebSearchTool } from '@/lib/tools/web-search-tool';
import { createNotionMcpTools } from '@/lib/tools/notion-tools';

/** Built-in tools shipped with the chat app. */
export function builtinToolRegistry(): ChatTool[] {
  return [createWebSearchTool()];
}

export function resolveEnabledTools(flags: ToolRuntimeFlags): ChatTool[] {
  const normalized: ToolRuntimeFlags = {
    searchEnabled: Boolean(flags.searchEnabled),
    integrations: Array.isArray(flags.integrations)
      ? flags.integrations.map((id) => String(id || '').trim().toLowerCase()).filter(Boolean)
      : [],
  };
  // Notion tools are loaded async via resolveEnabledToolsAsync (MCP listTools).
  return selectTools([...builtinToolRegistry()], normalized);
}

/**
 * Resolve enabled tools including live Notion MCP catalog when authorized.
 */
export async function resolveEnabledToolsAsync(
  flags: ToolRuntimeFlags,
  opts?: { notionAccessToken?: string },
): Promise<ChatTool[]> {
  const base = resolveEnabledTools(flags);
  if (!flags.integrations.includes('notion') || !opts?.notionAccessToken) {
    return base;
  }
  try {
    const notionTools = await createNotionMcpTools(opts.notionAccessToken);
    return [...base, ...notionTools];
  } catch (err) {
    console.warn('Notion MCP listTools failed:', err);
    return base;
  }
}

export {
  selectTools,
  openaiToolDefinitions,
  toolSystemPrompt,
  findTool,
  executeRegisteredTool,
  type ChatTool,
  type ToolRuntimeFlags,
  type ToolRuntimeContext,
  type ToolExecuteResult,
} from '@/lib/tools/registry';

export {
  runWebSearch,
  formatWebSearchToolContent,
  parseSearchQuery,
} from '@/lib/tools/web-search-tool';

export { createNotionMcpTools } from '@/lib/tools/notion-tools';
