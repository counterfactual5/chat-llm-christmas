/**
 * Client-safe builtin tool system-prompt estimate (no MCP / no execute).
 * Mirrors `toolSystemPrompt(resolveEnabledTools(flags))` for built-ins only.
 */

import {
  selectTools,
  toolSystemPrompt,
  type ChatTool,
  type ToolRuntimeFlags,
} from '@/lib/tools/registry';
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

/** Same builtin set as `builtinToolRegistry()` — keep in sync. */
function builtinToolsForGuidance(): ChatTool[] {
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

export function estimateBuiltinToolsGuidance(flags: ToolRuntimeFlags): string {
  return toolSystemPrompt(selectTools(builtinToolsForGuidance(), flags));
}
