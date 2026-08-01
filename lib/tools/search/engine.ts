/**
 * Multi-provider web search with fallback chain.
 * Order: Zhipu Coding Plan MCP → Tavily → Brave → Serper → …
 *
 *  types.ts      hit/outcome shapes
 *  freshness.ts  trim + stale year hints
 *  providers.ts  provider implementations + order
 *  format.ts     model-facing JSON serialization
 *  zhipu.ts      Zhipu MCP client
 *  tool.ts       registered chat tool wrapper
 */

import { PROVIDERS } from '@/lib/tools/search/providers';
import type { SearchOutcome, WebSearchOptions } from '@/lib/tools/search/types';
import { formatUnknownError } from '@/lib/tools/zhipu/mcp-helpers';

export type { SearchHit, SearchOutcome, WebSearchOptions } from '@/lib/tools/search/types';
export { annotateHitFreshness } from '@/lib/tools/search/freshness';
export { formatSearchResultsForModel } from '@/lib/tools/search/format';

/** Run the fallback chain until one provider returns results. */
export async function webSearch(
  query: string,
  options: WebSearchOptions = {},
): Promise<SearchOutcome> {
  const q = String(query || '').trim().slice(0, 500);
  if (!q) {
    return { provider: 'none', query: '', results: [], error: 'Empty query' };
  }

  const freshness = options.freshness ?? null;

  const errors: string[] = [];
  for (const provider of PROVIDERS) {
    if (!provider.available()) continue;
    try {
      const results = await provider.search(q, freshness);
      if (results.length > 0) {
        return { provider: provider.name, query: q, results };
      }
      errors.push(`${provider.name}: empty`);
      console.warn(`[web_search] ${provider.name} returned empty, trying next`);
    } catch (err: unknown) {
      const message = formatUnknownError(err);
      errors.push(`${provider.name}: ${message}`);
      console.warn(`[web_search] ${provider.name} failed, trying next: ${message}`);
    }
  }

  return {
    provider: 'none',
    query: q,
    results: [],
    error: errors.join(' | ') || 'All providers failed',
  };
}

export const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description:
      'Live web search. Call when the answer needs current or uncertain facts (news, prices, recent events, changing docs) — even if the user did not say “search”. Do NOT call for stable textbook knowledge you already know (definitions, which field a concept belongs to, classic formulas). Do not narrate a fake search. For time-sensitive queries only, add a calendar anchor from the latest message timestamp (e.g. 2026-07); never bolt a year onto timeless questions.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Full search query. Include year/month/ISO date ONLY when the user means recent/latest/this week — not for timeless definitions.',
        },
      },
      required: ['query'],
    },
  },
};
