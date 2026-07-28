import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import {
  callMcpTool,
  listMcpTools,
  type McpToolDefinition,
} from '@/lib/mcp/http-client';
import { GOOGLE_MCP_SERVERS, type GoogleService } from '@/lib/integrations/google-oauth';

const GOOGLE_SYSTEM_PROMPT = [
  "You have Google Workspace MCP tools (Gmail, Calendar, Drive) for the user's connected account.",
  'Gmail: search/read/compose drafts and send email when allowed by the user.',
  'Calendar: list, create, and update events.',
  'Drive: search, read, and create files you can access.',
  'For write actions (send email, create event, upload file, delete), confirm intent from the user message before calling.',
  'Do not invent message IDs, event IDs, or file IDs — only use tool results.',
  'Cite Gmail/Drive/ Calendar links from tool results when answering.',
].join(' ');

function googleToken(ctx: ToolRuntimeContext): string | null {
  const token = ctx.credentials?.googleAccessToken?.trim();
  return token || null;
}

function mcpOpts(accessToken: string, service: GoogleService) {
  return {
    serverUrl: GOOGLE_MCP_SERVERS[service].url,
    accessToken,
    userAgent: 'ChristmasChat-GoogleMCP/1.0',
  };
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
  return String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
}

function queryHint(name: string, args: Record<string, unknown>): string {
  const candidates = [
    args.query,
    args.q,
    args.filter,
    args.subject,
    args.to,
    args.email,
    args.name,
    args.messageId,
    args.eventId,
    args.fileId,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 120);
    if (typeof c === 'number') return String(c);
  }
  return name.replace(/^google[-_]/, '').replace(/_/g, ' ');
}

function isWriteTool(name: string): boolean {
  return /create|update|send|delete|remove|upload|insert|draft|modify|trash|move/i.test(name);
}

function extractUiResults(
  name: string,
  content: string,
): Array<{ title: string; url: string; snippet: string }> {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const results = parsed.items || parsed.results || parsed.messages || parsed.files;
    if (Array.isArray(results)) {
      return results.slice(0, 8).map((item) => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        const url = String(
          row.htmlLink || row.webViewLink || row.alternateLink || row.url || '',
        );
        return {
          title: String(row.subject || row.title || row.name || url || 'Result').slice(0, 120),
          url,
          snippet: String(row.snippet || row.body || row.description || '').slice(0, 240),
        };
      });
    }
    if (parsed.htmlLink || parsed.webViewLink || parsed.alternateLink || parsed.url) {
      return [
        {
          title: String(parsed.subject || parsed.title || parsed.name || name).slice(0, 120),
          url: String(parsed.htmlLink || parsed.webViewLink || parsed.alternateLink || parsed.url || ''),
          snippet: String(parsed.snippet || parsed.body || parsed.description || '').slice(0, 240),
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

function makeExecutors(
  service: GoogleService,
  def: McpToolDefinition,
): ChatTool {
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
        description: String(def.description || `Google ${service} MCP tool: ${name}`).slice(0, 1024),
        parameters,
      },
    },
    systemPrompt: GOOGLE_SYSTEM_PROMPT,
    enabled: (flags) => flags.integrations.includes('google'),
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const token = googleToken(ctx);
      if (!token) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'Google Workspace MCP is not connected for this account.',
          }),
        };
      }

      const args = parseArgs(rawArguments);
      if (
        /search|list|query/i.test(def.name) &&
        !args.query &&
        !args.q &&
        (fallbackQuery || ctx.userAsk)
      ) {
        args.query = String(fallbackQuery || ctx.userAsk).slice(0, 200);
      }

      const query = queryHint(name, args);
      const write = isWriteTool(def.name);
      ctx.send({
        tool: {
          status: 'start',
          name,
          query,
          provider: 'google',
          write,
        },
      });

      try {
        const outcome = await callMcpTool(mcpOpts(token, service), def.name, args);
        const results = extractUiResults(name, outcome.content);
        const error = outcome.isError
          ? outcome.content.slice(0, 280) || 'Google MCP tool returned an error'
          : undefined;

        ctx.send({
          tool: {
            status: 'done',
            name,
            query,
            provider: 'google',
            write,
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
        const message =
          err instanceof Error ? err.message : String(err || 'Google MCP call failed');
        ctx.send({
          tool: {
            status: 'done',
            name,
            query,
            provider: 'google',
            write,
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
 * Fetch all Google Workspace MCP tools (Gmail + Calendar + Drive) and flatten
 * them into ChatTool entries. Tool names are prefixed/appended with the service
 * to avoid collisions (e.g. `gmail_search_messages`, `calendar_create_event`).
 */
export async function createGoogleMcpTools(accessToken: string): Promise<ChatTool[]> {
  const tools: ChatTool[] = [];
  for (const service of Object.keys(GOOGLE_MCP_SERVERS) as GoogleService[]) {
    try {
      const defs = await listMcpTools(mcpOpts(accessToken, service));
      for (const def of defs) {
        // Prefix tool name with service to keep Gmail/Calendar/Drive unique.
        const namespaced: McpToolDefinition = {
          ...def,
          name: `${service}_${def.name}`,
        };
        tools.push(makeExecutors(service, namespaced));
      }
    } catch (err) {
      console.warn(`Google MCP listTools failed for ${service}:`, err);
    }
  }
  return tools;
}
