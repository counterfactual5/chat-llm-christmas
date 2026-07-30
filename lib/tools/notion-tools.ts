import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import {
  callNotionMcpTool,
  listNotionMcpTools,
  type McpToolDefinition,
} from '@/lib/notion/mcp-client';

const NOTION_SYSTEM_PROMPT = [
  "You have Notion MCP tools for the user's connected workspace (full page access matching their Notion permissions).",
  'Prefer notion-search to find pages, notion-fetch to read content (or id "self" for workspace/user identity), and create/update tools to write.',
  'notion-update-page REQUIRES a top-level string page_id (and usually command). Never omit page_id; never nest it under pages[], data, or parent — those shapes are invalid.',
  'If you do not already have a page_id from a prior tool result in THIS conversation, call notion-search or notion-fetch first, then pass that id into notion-update-page.',
  'Example: {"page_id":"<id from tool result>","command":"replace_content","new_str":"...markdown..."}.',
  'Do not invent Notion page IDs, titles, URLs, or content — only use tool results.',
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

/** Pull a page id from a Notion URL or bare UUID-ish string. */
function extractPageIdCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  // Notion URLs often end with a 32-hex id (with or without dashes).
  const fromUrl = s.match(
    /(?:notion\.(?:so|site)|notion\.com)\/(?:[^?#]*?-)?([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[?#]|$)/,
  );
  if (fromUrl?.[1]) return fromUrl[1];
  if (/^[0-9a-fA-F]{32}$/.test(s) || /^[0-9a-fA-F-]{36}$/.test(s)) return s;
  return null;
}

/**
 * Models often misplace page_id (id / pageId / nested under data|pages|parent).
 * Hoist common aliases before calling MCP so a retry isn't always required.
 */
function normalizeNotionArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };

  const pickPageId = (): string | null => {
    const direct =
      extractPageIdCandidate(out.page_id) ||
      extractPageIdCandidate(out.pageId) ||
      extractPageIdCandidate(out.id) ||
      extractPageIdCandidate(out.page) ||
      extractPageIdCandidate(out.url);
    if (direct) return direct;

    const data = out.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const d = data as Record<string, unknown>;
      const nested =
        extractPageIdCandidate(d.page_id) ||
        extractPageIdCandidate(d.pageId) ||
        extractPageIdCandidate(d.id);
      if (nested) return nested;
    }

    const parent = out.parent;
    if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
      const p = parent as Record<string, unknown>;
      // parent.page_id is for create under a parent — for update-page the target is page_id.
      const nested = extractPageIdCandidate(p.page_id) || extractPageIdCandidate(p.pageId);
      if (nested && /update-page|update_page/i.test(toolName)) return nested;
    }

    if (Array.isArray(out.pages) && out.pages[0] && typeof out.pages[0] === 'object') {
      const row = out.pages[0] as Record<string, unknown>;
      const nested =
        extractPageIdCandidate(row.page_id) ||
        extractPageIdCandidate(row.pageId) ||
        extractPageIdCandidate(row.id);
      if (nested) return nested;
    }
    return null;
  };

  if (/update-page|update_page|move-page|duplicate|fetch/i.test(toolName)) {
    if (!extractPageIdCandidate(out.page_id)) {
      const hoisted = pickPageId();
      if (hoisted) out.page_id = hoisted;
    }
  }

  return out;
}

function missingPageIdError(toolName: string): string {
  return [
    `Missing required top-level page_id for ${toolName}.`,
    'Resolve the target page with notion-search or notion-fetch (use an id from THAT tool result),',
    'then retry with arguments like:',
    '{"page_id":"<id>","command":"replace_content","new_str":"..."}',
    'Do not nest page_id under pages[], data, or parent.',
  ].join(' ');
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
  let parameters =
    def.inputSchema && typeof def.inputSchema === 'object'
      ? ({ ...(def.inputSchema as Record<string, unknown>) } as Record<string, unknown>)
      : { type: 'object', properties: {} };

  let description = String(def.description || `Notion MCP tool: ${name}`).slice(0, 900);
  if (/update-page|update_page/i.test(name)) {
    description = [
      'Update a Notion page. REQUIRED: top-level page_id (string from a prior search/fetch result).',
      'Also pass command (e.g. replace_content) and the fields that command needs (e.g. new_str).',
      'Never omit page_id; never nest it under pages/data/parent.',
      description,
    ]
      .join(' ')
      .slice(0, 1024);
    // Reinforce in the JSON schema the model sees for argument planning.
    const props =
      parameters.properties && typeof parameters.properties === 'object'
        ? ({ ...(parameters.properties as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const pageIdProp: Record<string, unknown> =
      props.page_id && typeof props.page_id === 'object'
        ? { ...(props.page_id as Record<string, unknown>) }
        : { type: 'string' };
    pageIdProp.description = [
      String(pageIdProp.description || '').trim(),
      'Required top-level page UUID/id from notion-search or notion-fetch. Do not nest.',
    ]
      .filter(Boolean)
      .join(' ');
    props.page_id = pageIdProp;
    parameters = { ...parameters, properties: props };
    const required = Array.isArray(parameters.required)
      ? [...(parameters.required as unknown[])]
      : [];
    if (!required.map(String).includes('page_id')) {
      parameters = { ...parameters, required: ['page_id', ...required.map(String)] };
    }
  }

  return {
    name,
    definition: {
      type: 'function',
      function: {
        name,
        description,
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

      let args = normalizeNotionArgs(name, parseArgs(rawArguments));
      // Soft fallback for search-like tools when model omits query.
      if (
        /search/i.test(name) &&
        !args.query &&
        (fallbackQuery || ctx.userAsk)
      ) {
        args = { ...args, query: String(fallbackQuery || ctx.userAsk).slice(0, 200) };
      }

      // Fail fast with an actionable message so the next tool round can self-correct.
      if (
        /update-page|update_page/i.test(name) &&
        !extractPageIdCandidate(args.page_id)
      ) {
        const error = missingPageIdError(name);
        ctx.send({
          tool: {
            status: 'done',
            name,
            query: queryHint(name, args),
            provider: 'notion',
            write: true,
            results: [],
            error: error.slice(0, 280),
          },
        });
        return { content: JSON.stringify({ ok: false, error, hint: 'retry_with_page_id' }) };
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
            ? JSON.stringify({
                ok: false,
                error: outcome.content,
                ...( /page_id|invalid_type/i.test(outcome.content)
                  ? { hint: 'retry_with_top_level_page_id_from_search_or_fetch' }
                  : {}),
              })
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
