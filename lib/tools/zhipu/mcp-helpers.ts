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

/** Prefer a readable string over "[object Object]" in logs / thrown Errors. */
export function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    const msg = String(err.message || '').trim();
    return msg || err.name || 'Error';
  }
  if (typeof err === 'string') return err.trim() || 'Error';
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    for (const key of ['message', 'error', 'msg', 'detail']) {
      const v = rec[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v === 'object') {
        const nested = formatUnknownError(v);
        if (nested && nested !== '[object Object]') return nested;
      }
    }
    try {
      return JSON.stringify(err).slice(0, 400);
    } catch {
      // fall through
    }
  }
  return String(err || 'Error');
}

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

function withHttps(hostOrUrl: string): string {
  const s = hostOrUrl.trim().replace(/\/$/, '');
  if (!s) return '';
  return s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`;
}

function internalProxyOrigin(): string {
  // Prefer a public hostname over VERCEL_URL. Deployment URLs
  // (*.vercel.app) are often behind Vercel Deployment Protection, which
  // blocks Edge→self fetches with "Protected deployment" even when the
  // custom domain (chat.llm.christmas) is open and returns our 401 JSON.
  const explicit = withHttps(
    process.env.CHAT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || '',
  );
  if (explicit) return explicit;
  const production = withHttps(process.env.VERCEL_PROJECT_PRODUCTION_URL || '');
  if (production) return production;
  if (process.env.VERCEL_ENV === 'production') {
    return 'https://chat.llm.christmas';
  }
  const vercel = withHttps(process.env.VERCEL_URL || '');
  if (vercel) return vercel;
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

function protectionBypassHeaders(): Record<string, string> {
  const bypass = (process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
  if (!bypass) return {};
  return { 'x-vercel-protection-bypass': bypass };
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
  const origin = internalProxyOrigin();
  const res = await fetch(`${origin}/api/internal/zhipu-mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-christmas-internal': secret,
      ...protectionBypassHeaders(),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const raw = await res.text().catch(() => '');
  let data: {
    ok?: boolean;
    error?: unknown;
    hits?: unknown;
    page?: unknown;
  } = {};
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {};
  } catch {
    throw new Error(
      `Zhipu Node proxy HTTP ${res.status} non-JSON from ${origin}: ${raw.slice(0, 180) || '(empty)'}`,
    );
  }
  if (!res.ok || !data.ok) {
    throw new Error(
      formatUnknownError(data.error) || `Zhipu Node proxy HTTP ${res.status} from ${origin}`,
    );
  }
  return data;
}
