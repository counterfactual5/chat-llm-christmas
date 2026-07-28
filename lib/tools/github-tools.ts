import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import {
  callMcpTool,
  listMcpTools,
  type McpToolDefinition,
} from '@/lib/mcp/http-client';
import { GITHUB_MCP_SERVER_URL } from '@/lib/integrations/github-oauth';

const GITHUB_SYSTEM_PROMPT = [
  "You have GitHub MCP tools for the user's connected account (repos, issues, PRs, Actions, etc.).",
  'Use search/list tools before mutating when the user only asked to explore.',
  'Do not invent repository names, issue numbers, or URLs — only use tool results.',
  'Cite repo/issue/PR links from tool results when answering.',
].join(' ');

function githubToken(ctx: ToolRuntimeContext): string | null {
  const token = ctx.credentials?.githubAccessToken?.trim();
  return token || null;
}

function mcpOpts(accessToken: string) {
  return {
    serverUrl: `${GITHUB_MCP_SERVER_URL.replace(/\/$/, '')}/readonly`,
    accessToken,
    userAgent: 'ChristmasChat-GitHubMCP/1.0',
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
    args.owner,
    args.repo,
    args.repository,
    args.issue_number,
    args.pull_number,
    args.url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 120);
    if (typeof c === 'number') return String(c);
  }
  return name.replace(/^github[-_]/, '').replace(/_/g, ' ');
}

function isWriteTool(name: string): boolean {
  return /create|update|merge|delete|close|reopen|push|fork|comment|assign|add|remove|edit/i.test(
    name,
  );
}

function extractUiResults(
  name: string,
  content: string,
): Array<{ title: string; url: string; snippet: string }> {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const results = parsed.items || parsed.results || parsed.repositories;
    if (Array.isArray(results)) {
      return results.slice(0, 8).map((item) => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        const htmlUrl = String(row.html_url || row.url || '');
        return {
          title: String(row.title || row.name || row.full_name || htmlUrl || 'Result').slice(
            0,
            120,
          ),
          url: htmlUrl,
          snippet: String(row.body || row.description || row.state || '').slice(0, 240),
        };
      });
    }
    if (parsed.html_url || parsed.url) {
      return [
        {
          title: String(parsed.title || parsed.name || name).slice(0, 120),
          url: String(parsed.html_url || parsed.url || ''),
          snippet: String(parsed.body || parsed.description || '').slice(0, 240),
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
        description: String(def.description || `GitHub MCP tool: ${name}`).slice(0, 1024),
        parameters,
      },
    },
    systemPrompt: GITHUB_SYSTEM_PROMPT,
    enabled: (flags) => flags.integrations.includes('github'),
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const token = githubToken(ctx);
      if (!token) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'GitHub MCP is not connected for this account.',
          }),
        };
      }

      const args = parseArgs(rawArguments);
      if (
        /search/i.test(def.name) &&
        !args.query &&
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
          provider: 'github',
          write,
        },
      });

      try {
        const outcome = await callMcpTool(mcpOpts(token), def.name, args);
        const results = extractUiResults(name, outcome.content);
        const error = outcome.isError
          ? outcome.content.slice(0, 280) || 'GitHub MCP tool returned an error'
          : undefined;

        ctx.send({
          tool: {
            status: 'done',
            name,
            query,
            provider: 'github',
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
        const message = err instanceof Error ? err.message : String(err || 'GitHub MCP call failed');
        ctx.send({
          tool: {
            status: 'done',
            name,
            query,
            provider: 'github',
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

export async function createGitHubMcpTools(accessToken: string): Promise<ChatTool[]> {
  const tools = await listMcpTools(mcpOpts(accessToken));
  if (!tools.length) return [];
  return tools.map(mcpToolToChatTool);
}
