/**
 * Minimal Notion MCP client over Streamable HTTP (Edge-safe, no Node SDK).
 * Protocol: JSON-RPC 2.0 against https://mcp.notion.com/mcp
 */

import { NOTION_MCP_SERVER_URL } from '@/lib/integrations/notion-mcp-oauth';

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type JsonRpcSuccess = {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function parseSseDataBlocks(text: string): unknown[] {
  const blocks: unknown[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      blocks.push(JSON.parse(payload));
    } catch {
      // ignore non-JSON SSE lines
    }
  }
  return blocks;
}

async function readJsonRpcResponse(response: Response): Promise<{
  body: JsonRpcSuccess | null;
  sessionId: string | null;
}> {
  const sessionId =
    response.headers.get('mcp-session-id') ||
    response.headers.get('Mcp-Session-Id');
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Notion MCP HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`,
    );
  }

  if (contentType.includes('text/event-stream') || text.includes('data:')) {
    const events = parseSseDataBlocks(text);
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev && typeof ev === 'object' && 'result' in (ev as object)) {
        return { body: ev as JsonRpcSuccess, sessionId };
      }
      if (ev && typeof ev === 'object' && 'error' in (ev as object)) {
        return { body: ev as JsonRpcSuccess, sessionId };
      }
    }
  }

  try {
    return { body: JSON.parse(text) as JsonRpcSuccess, sessionId };
  } catch {
    throw new Error(`Notion MCP returned non-JSON: ${text.slice(0, 200)}`);
  }
}

export class NotionMcpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(private readonly accessToken: string) {}

  private async rpc(
    method: string,
    params?: Record<string, unknown>,
    opts?: { notification?: boolean },
  ): Promise<unknown> {
    const id = opts?.notification ? undefined : this.nextId++;
    const payload: Record<string, unknown> = {
      jsonrpc: '2.0',
      method,
    };
    if (id !== undefined) payload.id = id;
    if (params !== undefined) payload.params = params;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'ChristmasChat-NotionMCP/1.0',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const response = await fetch(NOTION_MCP_SERVER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (opts?.notification) {
      const sid =
        response.headers.get('mcp-session-id') ||
        response.headers.get('Mcp-Session-Id');
      if (sid) this.sessionId = sid;
      // Drain body; notifications may return 202/empty
      await response.text().catch(() => '');
      return null;
    }

    const { body, sessionId } = await readJsonRpcResponse(response);
    if (sessionId) this.sessionId = sessionId;
    if (!body) throw new Error(`Notion MCP empty response for ${method}`);
    if (body.error) {
      throw new Error(body.error.message || `Notion MCP error on ${method}`);
    }
    return body.result;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'christmas-chat', version: '1.0.0' },
    });
    await this.rpc('notifications/initialized', {}, { notification: true });
    this.initialized = true;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    await this.ensureInitialized();
    const result = (await this.rpc('tools/list', {})) as {
      tools?: McpToolDefinition[];
    };
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }> {
    await this.ensureInitialized();
    const result = (await this.rpc('tools/call', {
      name,
      arguments: args,
    })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
      structuredContent?: unknown;
    };

    const texts = (result?.content || [])
      .filter((c) => c && (c.type === 'text' || typeof c.text === 'string'))
      .map((c) => String(c.text || ''))
      .filter(Boolean);

    let content = texts.join('\n');
    if (!content && result?.structuredContent != null) {
      content = JSON.stringify(result.structuredContent);
    }
    if (!content) content = JSON.stringify(result ?? {});

    return { content, isError: Boolean(result?.isError) };
  }

  /** Label connection via notion-fetch id=self (MCP-audienced tokens). */
  async fetchSelfLabel(): Promise<{ workspaceName?: string; userName?: string }> {
    try {
      const { content } = await this.callTool('notion-fetch', { id: 'self' });
      const parsed = JSON.parse(content) as {
        self?: {
          workspace?: { name?: string };
          user?: { name?: string };
        };
      };
      return {
        workspaceName: parsed?.self?.workspace?.name,
        userName: parsed?.self?.user?.name,
      };
    } catch {
      return {};
    }
  }
}

export async function listNotionMcpTools(
  accessToken: string,
): Promise<McpToolDefinition[]> {
  const client = new NotionMcpClient(accessToken);
  return client.listTools();
}

export async function callNotionMcpTool(
  accessToken: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
  const client = new NotionMcpClient(accessToken);
  return client.callTool(name, args);
}
