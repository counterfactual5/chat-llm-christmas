/**
 * Minimal MCP client over Streamable HTTP (Edge-safe).
 * JSON-RPC 2.0 against a hosted MCP endpoint.
 */

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
      `MCP HTTP ${response.status}: ${text.slice(0, 240) || response.statusText}`,
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
    throw new Error(`MCP returned non-JSON: ${text.slice(0, 200)}`);
  }
}

export type McpHttpClientOptions = {
  serverUrl: string;
  accessToken: string;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
};

export class McpHttpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(private readonly opts: McpHttpClientOptions) {}

  private async rpc(
    method: string,
    params?: Record<string, unknown>,
    rpcOpts?: { notification?: boolean },
  ): Promise<unknown> {
    const id = rpcOpts?.notification ? undefined : this.nextId++;
    const payload: Record<string, unknown> = {
      jsonrpc: '2.0',
      method,
    };
    if (id !== undefined) payload.id = id;
    if (params !== undefined) payload.params = params;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': this.opts.userAgent || 'ChristmasChat-MCP/1.0',
      ...this.opts.extraHeaders,
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const response = await fetch(this.opts.serverUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (rpcOpts?.notification) {
      const sid =
        response.headers.get('mcp-session-id') ||
        response.headers.get('Mcp-Session-Id');
      if (sid) this.sessionId = sid;
      await response.text().catch(() => '');
      return null;
    }

    const { body, sessionId } = await readJsonRpcResponse(response);
    if (sessionId) this.sessionId = sessionId;
    if (!body) throw new Error(`MCP empty response for ${method}`);
    if (body.error) {
      throw new Error(body.error.message || `MCP error on ${method}`);
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
}

export async function listMcpTools(
  opts: McpHttpClientOptions,
): Promise<McpToolDefinition[]> {
  const client = new McpHttpClient(opts);
  return client.listTools();
}

export async function callMcpTool(
  opts: McpHttpClientOptions,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
  const client = new McpHttpClient(opts);
  return client.callTool(name, args);
}
