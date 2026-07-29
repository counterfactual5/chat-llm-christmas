/**
 * Zhipu GLM Coding Plan remote MCP — web search + web reader.
 *
 * These endpoints are what the Coding Plan "MCP 每月额度" meter tracks.
 * The older PaaS REST paths (`/api/paas/v4/web_search`, `/reader`) bill
 * account balance / resource packs instead and do NOT move the MCP bar.
 *
 * Docs:
 * - https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server
 * - https://docs.bigmodel.cn/cn/coding-plan/mcp/reader-mcp-server
 *
 * Caveat: Zhipu says Coding Plan quotas are intended for supported coding
 * clients. Calling from this chat app may still work with a Coding Plan key,
 * but is not an officially listed environment.
 */

import { McpHttpClient } from '@/lib/mcp/http-client';

export const ZHIPU_MCP_SEARCH_URL =
  'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp';
export const ZHIPU_MCP_READER_URL =
  'https://open.bigmodel.cn/api/mcp/web_reader/mcp';

export function zhipuApiKey(): string | undefined {
  return (
    process.env.ZHIPU_CODING_API_KEY?.trim() ||
    process.env.ZHIPU_API_KEY?.trim() ||
    process.env.ZHIPUAI_API_KEY?.trim() ||
    process.env.BIGMODEL_API_KEY?.trim() ||
    undefined
  );
}

/** Prefer Coding Plan MCP unless explicitly disabled. */
export function zhipuMcpEnabled(): boolean {
  if (!zhipuApiKey()) return false;
  const flag = (process.env.ZHIPU_MCP_ENABLED || '1').trim().toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
}

function parseMaybeJson(text: string): unknown {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export type ZhipuMcpSearchHit = {
  title: string;
  url: string;
  snippet: string;
  media?: string;
};

/**
 * Call Coding Plan `webSearchPrime`.
 * Returns normalized hits; throws on MCP / tool errors.
 */
export async function zhipuMcpWebSearch(query: string): Promise<ZhipuMcpSearchHit[]> {
  const key = zhipuApiKey();
  if (!key) throw new Error('ZHIPU_API_KEY missing');

  const client = new McpHttpClient({
    serverUrl: ZHIPU_MCP_SEARCH_URL,
    accessToken: key,
    userAgent: 'ChristmasChat-ZhipuMCP/1.0',
  });

  const { content, isError } = await client.callTool('webSearchPrime', {
    search_query: String(query || '').trim().slice(0, 70),
  });
  if (isError) throw new Error(content.slice(0, 300) || 'webSearchPrime failed');

  const parsed = parseMaybeJson(content);
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { search_result?: unknown[] })?.search_result)
      ? ((parsed as { search_result: unknown[] }).search_result)
      : Array.isArray((parsed as { results?: unknown[] })?.results)
        ? ((parsed as { results: unknown[] }).results)
        : typeof parsed === 'object' && parsed
          ? [parsed]
          : [];

  const hits: ZhipuMcpSearchHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const url = String(r.link || r.url || r.href || '').trim();
    if (!url) continue;
    hits.push({
      title: String(r.title || r.media || r.siteName || url).trim(),
      url,
      snippet: String(r.content || r.snippet || r.summary || r.description || '').trim(),
      media: r.media ? String(r.media) : r.siteName ? String(r.siteName) : undefined,
    });
  }

  // Some MCP responses return a prose dump — treat as a single synthetic hit.
  if (!hits.length && typeof parsed === 'string' && parsed.trim()) {
    throw new Error(parsed.slice(0, 300));
  }
  if (!hits.length) throw new Error('Zhipu MCP webSearchPrime returned no results');
  return hits;
}

export type ZhipuMcpReadResult = {
  url: string;
  title?: string;
  description?: string;
  content: string;
};

/**
 * Call Coding Plan `webReader`.
 * Returns page markdown/text; throws on MCP / tool errors.
 */
export async function zhipuMcpWebRead(url: string): Promise<ZhipuMcpReadResult> {
  const key = zhipuApiKey();
  if (!key) throw new Error('ZHIPU_API_KEY missing');

  const client = new McpHttpClient({
    serverUrl: ZHIPU_MCP_READER_URL,
    accessToken: key,
    userAgent: 'ChristmasChat-ZhipuMCP/1.0',
  });

  const { content, isError } = await client.callTool('webReader', {
    url: String(url || '').trim(),
  });
  if (isError) throw new Error(content.slice(0, 300) || 'webReader failed');

  const parsed = parseMaybeJson(content);
  if (typeof parsed === 'string') {
    const text = parsed.trim();
    if (!text) throw new Error('Zhipu MCP webReader returned empty content');
    return { url, content: text };
  }

  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const nested =
    obj.reader_result && typeof obj.reader_result === 'object'
      ? (obj.reader_result as Record<string, unknown>)
      : obj;
  const body = String(
    nested.content || nested.text || nested.markdown || obj.content || '',
  ).trim();
  if (!body) throw new Error('Zhipu MCP webReader returned empty content');

  return {
    url: String(nested.url || obj.url || url),
    title: nested.title ? String(nested.title) : undefined,
    description: nested.description ? String(nested.description) : undefined,
    content: body,
  };
}
