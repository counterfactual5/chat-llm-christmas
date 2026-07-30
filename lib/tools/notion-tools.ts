import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import {
  callNotionMcpTool,
  listNotionMcpTools,
  type McpToolDefinition,
} from '@/lib/notion/mcp-client';

const NOTION_SYSTEM_PROMPT = [
  "You have Notion MCP tools for the user's connected workspace (full page access matching their Notion permissions).",
  'Prefer notion-search to find pages, notion-fetch to read content (or id "self" for workspace/user identity), and create/update tools to write.',
  'Do not invent Notion page IDs, titles, URLs, or content — only use tool results.',
  'Never claim you created, updated, moved, or deleted a Notion page unless a write tool in THIS turn returned success with a real URL/id from the tool payload.',
  'If you intend to write, you MUST emit a real Notion write tool_call — narrating "正在更新页面" / "已更新" without tools is a hard failure.',
  'If write tools are unavailable or fail, say so clearly and offer copy-pasteable markdown instead of fabricating app.notion.com / notion.so links.',
  'Ask before making large destructive edits when the user intent is ambiguous.',
  'Cite page titles and URLs from tool results when answering.',
].join(' ');

function notionToken(ctx: ToolRuntimeContext): string | null {
  const token = ctx.credentials?.notionAccessToken?.trim();
  return token || null;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sanitizeToolName(name: string): string {
  // OpenAI-compatible function names: letters, digits, underscore, hyphen.
  return String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
}

function queryHint(name: string, args: Record<string, unknown>): string {
  const candidates = [
    args.query,
    args.id,
    args.page_id,
    args.pageId,
    args.url,
    args.title,
    args.new_str,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 120);
  }
  if (Array.isArray(args.pages) && args.pages.length) {
    return `${args.pages.length} page(s)`;
  }
  return name.replace(/^notion-/, '').replace(/_/g, ' ');
}

function isWriteTool(name: string): boolean {
  return /create|update|move|duplicate|append|delete|trash|comment|view/i.test(name);
}

function extractUiResults(
  name: string,
  content: string,
): Array<{ title: string; url: string; snippet: string }> {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    // Search-like payloads
    const results = parsed.results || parsed.pages || parsed.items;
    if (Array.isArray(results)) {
      return results.slice(0, 8).map((item) => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          title: String(row.title || row.name || row.id || 'Result').slice(0, 120),
          url: String(row.url || row.page_url || ''),
          snippet: String(row.snippet || row.text || row.id || '').slice(0, 240),
        };
      });
    }
    if (parsed.title || parsed.url || parsed.id) {
      return [
        {
          title: String(parsed.title || name).slice(0, 120),
          url: String(parsed.url || ''),
          snippet: String(parsed.text || parsed.id || '').slice(0, 240),
        },
      ];
    }
  } catch {
    // plain text
  }
  const snippet = content.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!snippet) return [];
  return [{ title: name, url: '', snippet }];
}

function mcpToolToChatTool(def: McpToolDefinition): ChatTool {
  const name = sanitizeToolName(def.name);
  const parameters =
    def.inputSchema && typeof def.inputSchema === 'object'
      ? (def.inputSchema as Record<string, unknown>)
      : { type: 'object', properties: {} };

  return {
    name,
    definition: {
      type: 'function',
      function: {
        name,
        description: String(def.description || `Notion MCP tool: ${name}`).slice(0, 1024),
        parameters,
      },
    },
    systemPrompt: NOTION_SYSTEM_PROMPT,
    enabled: (flags) => flags.integrations.includes('notion'),
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const token = notionToken(ctx);
      if (!token) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'Notion MCP is not connected for this account.',
          }),
        };
      }

      const args = parseArgs(rawArguments);
      // Soft fallback for search-like tools when model omits query.
      if (
        /search/i.test(name) &&
        !args.query &&
        (fallbackQuery || ctx.userAsk)
      ) {
        args.query = String(fallbackQuery || ctx.userAsk).slice(0, 200);
      }

      const query = queryHint(name, args);
      ctx.send({
        tool: {
          status: 'start',
          name,
          query,
          provider: 'notion',
          write: isWriteTool(name),
        },
      });

      try {
        const outcome = await callNotionMcpTool(token, def.name, args);
        const results = extractUiResults(name, outcome.content);
        const error = outcome.isError
          ? outcome.content.slice(0, 280) || 'Notion MCP tool returned an error'
          : undefined;

        ctx.send({
          tool: {
            status: 'done',
            name,
            query,
            provider: 'notion',
            write: isWriteTool(name),
            results,
            error,
          },
        });

        return {
          content: outcome.isError
            ? JSON.stringify({ ok: false, error: outcome.content })
            : outcome.content,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err || 'Notion MCP call failed');
        ctx.send({
          tool: {
            status: 'done',
            name,
            query,
            provider: 'notion',
            write: isWriteTool(name),
            results: [],
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
    },
  };
}

/**
 * Build ChatTools by listing the live Notion hosted MCP tool catalog.
 * Falls back to an empty list on failure (caller should surface reconnect).
 */
export async function createNotionMcpTools(accessToken: string): Promise<ChatTool[]> {
  const tools = await listNotionMcpTools(accessToken);
  if (!tools.length) return [];
  // Attach system prompt once via first tool; duplicates are fine (joined uniquely enough).
  return tools.map(mcpToolToChatTool);
}
