/**
 * Zhipu Coding Plan MCP backend for web search.
 */

import {
  ZHIPU_MCP_SEARCH_URL,
  createZhipuMcpClient,
  parseMaybeJson,
  resolveToolName,
} from '@/lib/tools/zhipu/mcp-helpers';

export type ZhipuMcpSearchHit = {
  title: string;
  url: string;
  snippet: string;
  media?: string;
};

/**
 * Call Coding Plan web search MCP (`webSearchPrime` / `web_search_prime`).
 * Returns normalized hits; throws on MCP / tool errors.
 */
export async function zhipuMcpWebSearch(query: string): Promise<ZhipuMcpSearchHit[]> {
  const client = createZhipuMcpClient(ZHIPU_MCP_SEARCH_URL);
  // Community curls that succeed use snake_case; docs list camelCase.
  const toolName = await resolveToolName(client, [
    'web_search_prime',
    'webSearchPrime',
  ]);

  const { content, isError } = await client.callTool(toolName, {
    search_query: String(query || '').trim().slice(0, 70),
    content_size: 'medium',
  });
  if (isError) throw new Error(content.slice(0, 300) || `${toolName} failed`);

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

  // Some MCP responses return a prose dump — only then treat as failure text.
  if (!hits.length && typeof parsed === 'string' && parsed.trim()) {
    // Still looks like JSON we failed to unwrap — don't throw the raw blob as "error".
    if (/^\s*[\[{]/.test(parsed)) {
      throw new Error(`Zhipu MCP ${toolName} returned unparseable JSON results`);
    }
    throw new Error(parsed.slice(0, 300));
  }
  if (!hits.length) throw new Error(`Zhipu MCP ${toolName} returned no results`);
  return hits;
}
