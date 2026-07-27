import type { ChatTool, ToolRuntimeFlags } from '@/lib/tools/registry';
import { selectTools } from '@/lib/tools/registry';
import { createWebSearchTool } from '@/lib/tools/web-search-tool';
import { createNotionTools } from '@/lib/tools/notion-tools';

/** Built-in tools shipped with the chat app. */
export function builtinToolRegistry(): ChatTool[] {
  return [createWebSearchTool()];
}

/**
 * MCP / OAuth-backed tools. Each tool must gate on `flags.integrations`
 * so toggling off in the composer removes them from the model context.
 */
export function mcpToolRegistry(): ChatTool[] {
  return createNotionTools();
}

export function resolveEnabledTools(flags: ToolRuntimeFlags): ChatTool[] {
  const normalized: ToolRuntimeFlags = {
    searchEnabled: Boolean(flags.searchEnabled),
    integrations: Array.isArray(flags.integrations)
      ? flags.integrations.map((id) => String(id || '').trim().toLowerCase()).filter(Boolean)
      : [],
  };
  return selectTools([...builtinToolRegistry(), ...mcpToolRegistry()], normalized);
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
