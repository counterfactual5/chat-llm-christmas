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

function sanitizeMcpErrorBody(text: string): string {
  const raw = String(text || '').trim();
  if (!raw) return '(empty)';
  // Never dump HTML error pages into the chat UI.
  if (/<!doctype|<html/i.test(raw)) {
    const title = raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    if (/余额不足|无可用资源包|InsufficientBalance|recharge/i.test(raw)) {
      return '余额不足或无可用资源包（请确认使用 Coding Plan 套餐 Key）';
    }
    return title ? `HTML error page (${title})` : 'HTML error page';
  }
  return raw.slice(0, 240);
}

function formatHttpError(status: number, text: string): string {
  const body = sanitizeMcpErrorBody(text);
  if (/余额不足|无可用资源包|InsufficientBalance|recharge/i.test(text)) {
    return `MCP HTTP ${status}: 余额不足或无可用资源包（请确认使用 Coding Plan 套餐 Key，而不是普通平台 Key）`;
  }
  return `MCP HTTP ${status}: ${body}`;
}

function assertNotGatewayError(text: string): void {
  // Zhipu / some gateways return HTTP 200 with { code, msg, success:false }.
  let maybe: {
    code?: number | string;
    msg?: string;
    message?: string;
    success?: boolean;
    jsonrpc?: string;
  };
  try {
    maybe = JSON.parse(text) as typeof maybe;
  } catch {
    return;
  }
  if (
    maybe &&
    typeof maybe === 'object' &&
    maybe.jsonrpc !== '2.0' &&
    (maybe.success === false ||
      (maybe.code != null && maybe.code !== 0 && maybe.code !== '0'))
  ) {
    throw new Error(
      String(maybe.msg || maybe.message || `MCP gateway error ${maybe.code}`).slice(
        0,
        300,
      ),
    );
  }
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
    throw new Error(formatHttpError(response.status, text));
  }

  assertNotGatewayError(text);

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
    throw new Error(`MCP returned non-JSON: ${sanitizeMcpErrorBody(text)}`);
  }
}

export type McpHttpClientOptions = {
  serverUrl: string;
  accessToken: string;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  /** Prefer older protocol when talking to Zhipu Coding Plan MCP. */
  protocolVersion?: string;
  /** Require Mcp-Session-Id after initialize (Zhipu streamable HTTP). */
  requireSession?: boolean;
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
      // Zhipu examples prefer event-stream first.
      Accept: 'text/event-stream, application/json',
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
      const text = await response.text().catch(() => '');
      // 202 / 204 / empty 200 are fine for notifications; hard failures are not.
      if (!response.ok && response.status !== 202 && response.status !== 204) {
        throw new Error(formatHttpError(response.status, text));
      }
      if (text) assertNotGatewayError(text);
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

    const versions = [
      this.opts.protocolVersion || '2024-11-05',
      '2025-03-26',
    ].filter((v, i, arr) => arr.indexOf(v) === i);

    let lastErr: unknown;
    for (const protocolVersion of versions) {
      try {
        this.sessionId = null;
        await this.rpc('initialize', {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: 'christmas-chat', version: '1.0.0' },
        });
        if (this.opts.requireSession && !this.sessionId) {
          throw new Error(
            'MCP initialize succeeded but no Mcp-Session-Id (check Coding Plan Key)',
          );
        }
        await this.rpc('notifications/initialized', {}, { notification: true });
        this.initialized = true;
        return;
      } catch (err) {
        lastErr = err;
        this.sessionId = null;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error('MCP initialize failed');
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
