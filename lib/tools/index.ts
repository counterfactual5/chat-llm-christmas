import type { ChatTool, ToolRuntimeFlags } from '@/lib/tools/registry';
import { selectTools } from '@/lib/tools/registry';
import { createWebSearchTool } from '@/lib/tools/web-search-tool';
import { createNotionMcpTools } from '@/lib/tools/notion-tools';
import { createGitHubMcpTools } from '@/lib/tools/github-tools';
import { createGoogleMcpTools } from '@/lib/tools/google-tools';

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
  opts?: { notionAccessToken?: string; githubAccessToken?: string; googleAccessToken?: string },
): Promise<ChatTool[]> {
  let tools = resolveEnabledTools(flags);
  if (flags.integrations.includes('notion') && opts?.notionAccessToken) {
    try {
      const notionTools = await createNotionMcpTools(opts.notionAccessToken);
      tools = [...tools, ...notionTools];
    } catch (err) {
      console.warn('Notion MCP listTools failed:', err);
    }
  }
  if (flags.integrations.includes('github') && opts?.githubAccessToken) {
    try {
      const githubTools = await createGitHubMcpTools(opts.githubAccessToken);
      tools = [...tools, ...githubTools];
    } catch (err) {
      console.warn('GitHub MCP listTools failed:', err);
    }
  }
  if (flags.integrations.includes('google') && opts?.googleAccessToken) {
    try {
      const googleTools = await createGoogleMcpTools(opts.googleAccessToken);
      tools = [...tools, ...googleTools];
    } catch (err) {
      console.warn('Google MCP listTools failed:', err);
    }
  }
  return tools;
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
export { createGitHubMcpTools } from '@/lib/tools/github-tools';
export { createGoogleMcpTools } from '@/lib/tools/google-tools';
