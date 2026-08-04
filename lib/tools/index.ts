import type { ChatTool, ToolRuntimeFlags } from '@/lib/tools/registry';
import { selectTools } from '@/lib/tools/registry';
import { createWebSearchTool } from '@/lib/tools/search/tool';
import { createWebReadTool } from '@/lib/tools/web-read/tool';
import { createImageUnderstandTool } from '@/lib/tools/image-understand/tool';
import { createSaveSkillTool } from '@/lib/tools/save-skill/tool';
import { createCreateFileTool } from '@/lib/tools/create-file/tool';
import { createCreateSpreadsheetTool } from '@/lib/tools/create-spreadsheet/tool';
import { createFileReadTool } from '@/lib/tools/file-read/tool';
import { createDocxExtractTool } from '@/lib/tools/docx-extract/tool';
import { createXlsxExtractTool } from '@/lib/tools/xlsx-extract/tool';
import {
  createPaperSearchTool,
  createBookSearchTool,
} from '@/lib/tools/literature/tool';
import { createGenerateImageTool } from '@/lib/tools/image-generate/tool';
import { createNotionMcpTools } from '@/lib/mcp/notion/tools';
import { createGitHubMcpTools } from '@/lib/mcp/github/tools';
import { createGoogleTools } from '@/lib/mcp/google/tools';
import { wantsGoogleToken, enabledGoogleServices } from '@/lib/integrations/google/services';

/** Built-in tools shipped with the chat app. */
export function builtinToolRegistry(): ChatTool[] {
  return [
    createWebSearchTool(),
    createWebReadTool(),
    createPaperSearchTool(),
    createBookSearchTool(),
    createGenerateImageTool(),
    createImageUnderstandTool(),
    createFileReadTool(),
    createDocxExtractTool(),
    createXlsxExtractTool(),
    createSaveSkillTool(),
    createCreateFileTool(),
    createCreateSpreadsheetTool(),
  ];
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
  if (wantsGoogleToken(flags.integrations) && opts?.googleAccessToken) {
    try {
      const services = enabledGoogleServices(flags.integrations);
      const googleTools = await createGoogleTools(opts.googleAccessToken, services);
      tools = [...tools, ...googleTools];
    } catch (err) {
      console.warn('Google tools failed to load:', err);
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
} from '@/lib/tools/search/tool';

export { createWebReadTool, runWebRead, parseReadUrl } from '@/lib/tools/web-read/tool';

export {
  createImageUnderstandTool,
  parseImageUnderstandArgs,
} from '@/lib/tools/image-understand/tool';

export {
  createCreateFileTool,
  sanitizeGeneratedFilename,
  mimeFromFilename,
} from '@/lib/tools/create-file/tool';

export {
  createCreateSpreadsheetTool,
  parseCreateSpreadsheetArgs,
} from '@/lib/tools/create-spreadsheet/tool';

export {
  createFileReadTool,
  parseFileReadArgs,
  normalizeFileId,
} from '@/lib/tools/file-read/tool';

export {
  createDocxExtractTool,
  parseDocxExtractArgs,
  sectionsFromDocxHtml,
  outlineFromDocxHtml,
  commentsFromCommentsXml,
  htmlFragmentToMarkdown,
} from '@/lib/tools/docx-extract/tool';

export {
  createXlsxExtractTool,
  parseXlsxExtractArgs,
} from '@/lib/tools/xlsx-extract/tool';

export {
  createPaperSearchTool,
  createBookSearchTool,
} from '@/lib/tools/literature/tool';

export { createGenerateImageTool } from '@/lib/tools/image-generate/tool';

export {
  OPTIONAL_BUILTIN_TOOL_IDS,
  isOptionalBuiltinToolId,
  type OptionalBuiltinToolId,
} from '@/lib/tools/optional-builtins';

export { createNotionMcpTools } from '@/lib/mcp/notion/tools';
export { createGitHubMcpTools } from '@/lib/mcp/github/tools';
export { createGoogleTools, createGoogleMcpTools } from '@/lib/mcp/google/tools';
