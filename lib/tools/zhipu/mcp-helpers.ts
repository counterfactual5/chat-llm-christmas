/**
 * Shared Zhipu Coding Plan MCP client helpers (search + reader servers).
 *
 * Docs:
 * - https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server
 * - https://docs.bigmodel.cn/cn/coding-plan/mcp/reader-mcp-server
 */

import { McpHttpClient } from '@/lib/mcp/http-client';
import { zhipuApiKey } from '@/lib/tools/zhipu/credentials';

export const ZHIPU_MCP_SEARCH_URL =
  'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp';
export const ZHIPU_MCP_READER_URL =
  'https://open.bigmodel.cn/api/mcp/web_reader/mcp';

export function parseMaybeJson(text: string): unknown {
  const raw = String(text || '').trim();
  if (!raw) return null;
  // Zhipu MCP often returns a JSON-encoded string that itself contains JSON
  // (double-encoded array/object). Unwrap up to twice.
  let cur: unknown = raw;
  for (let i = 0; i < 2; i++) {
    if (typeof cur !== 'string') return cur;
    const s = cur.trim();
    if (!s || (s[0] !== '{' && s[0] !== '[' && s[0] !== '"')) return cur;
    try {
      cur = JSON.parse(s);
    } catch {
      return i === 0 ? raw : cur;
    }
  }
  return cur;
}

export function createZhipuMcpClient(serverUrl: string): McpHttpClient {
  const key = zhipuApiKey();
  if (!key) throw new Error('ZHIPU_API_KEY missing');
  return new McpHttpClient({
    serverUrl,
    accessToken: key,
    userAgent: 'ChristmasChat-ZhipuMCP/1.0',
    // Working community curls use 2024-11-05 + require session.
    protocolVersion: '2024-11-05',
    requireSession: true,
  });
}

/**
 * Docs say camelCase; working clients often use snake_case.
 * Prefer tools/list, then try known aliases.
 */
export async function resolveToolName(
  client: McpHttpClient,
  preferred: string[],
): Promise<string> {
  try {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name).filter(Boolean);
    for (const want of preferred) {
      const hit = names.find((n) => n === want);
      if (hit) return hit;
    }
    const lower = preferred.map((p) => p.toLowerCase());
    const fuzzy = names.find((n) => lower.includes(n.toLowerCase()));
    if (fuzzy) return fuzzy;
  } catch {
    // listTools optional — fall through to preferred names
  }
  return preferred[0]!;
}

/** True inside Vercel Edge isolates (not Node serverless). */
export function isVercelEdgeRuntime(): boolean {
  return typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== 'undefined';
}

function internalProxyOrigin(): string {
  const explicit = (process.env.CHAT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;
  const vercel = (process.env.VERCEL_URL || '').trim().replace(/\/$/, '');
  if (vercel) return vercel.startsWith('http') ? vercel : `https://${vercel}`;
  return 'https://chat.llm.christmas';
}

function internalProxySecret(): string {
  return (
    process.env.INTERNAL_PROVIDER_SECRET?.trim() ||
    process.env.ZHIPU_CODING_API_KEY?.trim() ||
    process.env.ZHIPU_API_KEY?.trim() ||
    ''
  );
}

/**
 * On Edge, call the Node.js `/api/internal/zhipu-mcp` proxy.
 * Direct Edge → open.bigmodel.cn frequently returns HTML 405.
 */
export async function callZhipuMcpViaNodeProxy(body: {
  action: 'search' | 'read';
  query?: string;
  url?: string;
}): Promise<unknown> {
  const secret = internalProxySecret();
  if (!secret) throw new Error('ZHIPU_API_KEY missing for Edge→Node proxy');
  const res = await fetch(`${internalProxyOrigin()}/api/internal/zhipu-mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-christmas-internal': secret,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    hits?: unknown;
    page?: unknown;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Zhipu Node proxy HTTP ${res.status}`);
  }
  return data;
}
