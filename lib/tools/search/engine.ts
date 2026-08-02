/**
 * Multi-provider web search — thin client to chat-api `/v1/tools/web_search`.
 * Engines (Zhipu → Tavily → … → Wiki) live on the product backend.
 */

import { chatBackendToolsURL } from '@/lib/chat-backend';
import type { SearchOutcome, WebSearchOptions } from '@/lib/tools/search/types';

export type { SearchHit, SearchOutcome, WebSearchOptions } from '@/lib/tools/search/types';
export { annotateHitFreshness } from '@/lib/tools/search/freshness';
export { formatSearchResultsForModel } from '@/lib/tools/search/format';

export type WebSearchClientOptions = WebSearchOptions & {
  /** Main-site sk- key (Bearer) — required to call chat-api. */
  apiKey?: string;
  /** Abort / timeout for the backend hop. */
  signal?: AbortSignal;
};

/** Run search via chat-api shared engine. */
export async function webSearch(
  query: string,
  options: WebSearchClientOptions = {},
): Promise<SearchOutcome> {
  const q = String(query || '').trim().slice(0, 500);
  if (!q) {
    return { provider: 'none', query: '', results: [], error: 'Empty query' };
  }

  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    return {
      provider: 'none',
      query: q,
      results: [],
      error: 'Web search requires a connected account',
    };
  }

  const freshness = options.freshness ?? null;
  try {
    const res = await fetch(chatBackendToolsURL('web_search'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: q, freshness }),
      cache: 'no-store',
      signal: options.signal ?? AbortSignal.timeout(35_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      provider?: string;
      query?: string;
      results?: SearchOutcome['results'];
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      return {
        provider: 'none',
        query: q,
        results: [],
        error: data.error || data.message || `HTTP ${res.status}`,
      };
    }
    return {
      provider: String(data.provider || 'none'),
      query: String(data.query || q),
      results: Array.isArray(data.results) ? data.results : [],
      error: data.error || undefined,
    };
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : '';
    const message =
      name === 'TimeoutError' || name === 'AbortError'
        ? 'Search timed out'
        : err instanceof Error
          ? err.message
          : String(err);
    return { provider: 'none', query: q, results: [], error: message };
  }
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
