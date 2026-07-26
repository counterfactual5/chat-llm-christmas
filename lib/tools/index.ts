import type { ChatTool, ToolRuntimeFlags } from '@/lib/tools/registry';
import { selectTools } from '@/lib/tools/registry';
import { createWebSearchTool } from '@/lib/tools/web-search-tool';

/** Built-in tools shipped with the chat app (MCP tools register elsewhere later). */
export function builtinToolRegistry(): ChatTool[] {
  return [createWebSearchTool()];
}

export function resolveEnabledTools(flags: ToolRuntimeFlags): ChatTool[] {
  return selectTools(builtinToolRegistry(), flags);
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
