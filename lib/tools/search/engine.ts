/**
 * Multi-provider web search with fallback chain.
 * Order: Zhipu Coding Plan MCP → Tavily → Brave → Serper → …
 */

import {
  freshnessForQuery,
  type Freshness,
} from '@/lib/chat/time-context';
import { zhipuMcpEnabled } from '@/lib/tools/zhipu/credentials';
import { zhipuMcpWebSearch } from '@/lib/tools/search/zhipu';

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  /** ISO date or provider date string when available. */
  publishedAt?: string;
  /** Human age label from provider, e.g. "2 days ago". */
  age?: string;
};

export type SearchOutcome = {
  provider: string;
  query: string;
  results: SearchHit[];
  error?: string;
};

export type WebSearchOptions = {
  /** Prefer recent documents when the query is time-sensitive. */
  freshness?: Freshness | null;
};

const MAX_RESULTS = 8;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function trimHit(hit: SearchHit): SearchHit {
  const out: SearchHit = {
    title: decodeEntities((hit.title || '').trim()).slice(0, 300),
    url: (hit.url || '').trim(),
    snippet: decodeEntities((hit.snippet || '').trim()).slice(0, 600),
  };
  if (hit.publishedAt?.trim()) out.publishedAt = hit.publishedAt.trim().slice(0, 64);
  if (hit.age?.trim()) out.age = hit.age.trim().slice(0, 64);
  return out;
}

function yearsInText(text: string): number[] {
  const years: number[] = [];
  for (const m of String(text || '').matchAll(/\b(20\d{2})\b/g)) {
    years.push(Number(m[1]));
  }
  return years;
}

/** Flag hits whose title/snippet years look older than the requested window. */
export function annotateHitFreshness(
  hit: SearchHit,
  asOfIsoDate: string,
  freshness: Freshness | null,
): SearchHit & { staleHint?: boolean; yearHints?: number[] } {
  const asOfYear = Number(asOfIsoDate.slice(0, 4));
  const yearHints = yearsInText(`${hit.title} ${hit.snippet} ${hit.publishedAt || ''}`);
  if (!yearHints.length || !Number.isFinite(asOfYear)) {
    return { ...hit, yearHints: yearHints.length ? yearHints : undefined };
  }
  const newestMentioned = Math.max(...yearHints);
  // For week/day requests, any explicit year older than asOf year is suspicious;
  // for month/year, allow same calendar year.
  let staleHint = false;
  if (freshness === 'day' || freshness === 'week') {
    staleHint = newestMentioned < asOfYear;
  } else if (freshness === 'month') {
    staleHint = newestMentioned < asOfYear;
  } else if (freshness === 'year') {
    staleHint = newestMentioned < asOfYear - 1;
  } else {
    staleHint = newestMentioned <= asOfYear - 2;
  }
  return { ...hit, yearHints, staleHint: staleHint || undefined };
}

/**
 * Zhipu Coding Plan MCP only — the PaaS REST `/web_search` bills account
 * balance and never touches the MCP monthly quota, so it is not used here.
 * docs: https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server
 */
async function searchZhipu(query: string, _freshness?: Freshness | null): Promise<SearchHit[]> {
  if (!zhipuMcpEnabled()) throw new Error('Zhipu MCP disabled');
  const mcpHits = await zhipuMcpWebSearch(query);
  const hits = mcpHits
    .map((r) =>
      trimHit({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }),
    )
    .filter((h) => h.url);
  if (!hits.length) throw new Error('Zhipu MCP webSearchPrime returned no results');
  return hits.slice(0, MAX_RESULTS);
}

async function searchTavily(query: string, freshness?: Freshness | null): Promise<SearchHit[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('TAVILY_API_KEY missing');
  const body: Record<string, unknown> = {
    api_key: key,
    query,
    search_depth: 'basic',
    max_results: MAX_RESULTS,
    include_answer: false,
  };
  if (freshness) {
    body.topic = 'news';
    body.time_range = freshness;
  }
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      published_date?: string;
    }>;
  };
  return (data.results || [])
    .map((r) =>
      trimHit({
        title: r.title || r.url || '',
        url: r.url || '',
        snippet: r.content || '',
        publishedAt: r.published_date,
      }),
    )
    .filter((h) => h.url);
}

async function searchBrave(query: string, freshness?: Freshness | null): Promise<SearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error('BRAVE_SEARCH_API_KEY missing');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(MAX_RESULTS));
  if (freshness === 'day') url.searchParams.set('freshness', 'pd');
  else if (freshness === 'week') url.searchParams.set('freshness', 'pw');
  else if (freshness === 'month') url.searchParams.set('freshness', 'pm');
  else if (freshness === 'year') url.searchParams.set('freshness', 'py');
  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': key,
    },
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = (await res.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        age?: string;
        page_age?: string;
      }>;
    };
  };
  return (data.web?.results || [])
    .map((r) =>
      trimHit({
        title: r.title || r.url || '',
        url: r.url || '',
        snippet: r.description || '',
        age: r.age || r.page_age,
        publishedAt: r.page_age,
      }),
    )
    .filter((h) => h.url);
}

async function searchSerper(query: string, freshness?: Freshness | null): Promise<SearchHit[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('SERPER_API_KEY missing');
  const body: Record<string, unknown> = { q: query, num: MAX_RESULTS };
  if (freshness === 'day') body.tbs = 'qdr:d';
  else if (freshness === 'week') body.tbs = 'qdr:w';
  else if (freshness === 'month') body.tbs = 'qdr:m';
  else if (freshness === 'year') body.tbs = 'qdr:y';
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': key,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
  };
  return (data.organic || [])
    .map((r) =>
      trimHit({
        title: r.title || r.link || '',
        url: r.link || '',
        snippet: r.snippet || '',
        publishedAt: r.date,
        age: r.date,
      }),
    )
    .filter((h) => h.url);
}

/** Decode DuckDuckGo redirect links (uddg=). */
function unwrapDdgUrl(href: string): string {
  try {
    const absolute = href.startsWith('//') ? `https:${href}` : href;
    const u = new URL(absolute, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    if (absolute.startsWith('http')) return absolute;
  } catch {
    /* ignore */
  }
  return href;
}

/**
 * Free fallback: DuckDuckGo HTML results (GET).
 * No API key. Best-effort parsing; may be rate-limited / challenged.
 */
async function searchDuckDuckGo(query: string): Promise<SearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query }).toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();

  const hits: SearchHit[] = [];
  const blockRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,800}?class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) && hits.length < MAX_RESULTS) {
    const rawUrl = (m[1] || '').replace(/&amp;/g, '&');
    const title = (m[2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const snippet = (m[3] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const link = unwrapDdgUrl(rawUrl);
    if (!link || !title) continue;
    if (link.includes('duckduckgo.com/y.js')) continue;
    hits.push(trimHit({ title, url: link, snippet }));
  }

  // Title-only fallback if snippets failed to pair.
  if (hits.length === 0) {
    const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = titleRe.exec(html)) && hits.length < MAX_RESULTS) {
      const rawUrl = (m[1] || '').replace(/&amp;/g, '&');
      const title = (m[2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const link = unwrapDdgUrl(rawUrl);
      if (!link || !title) continue;
      hits.push(trimHit({ title, url: link, snippet: '' }));
    }
  }

  if (hits.length === 0) throw new Error('DuckDuckGo returned no results');
  return hits;
}

/** Last-resort free source: Wikipedia OpenSearch (not a full web search). */
async function searchWikipedia(query: string, lang: 'en' | 'zh' = 'en'): Promise<SearchHit[]> {
  const host = lang === 'zh' ? 'zh.wikipedia.org' : 'en.wikipedia.org';
  const endpoint = `https://${host}/w/api.php?${new URLSearchParams({
    action: 'opensearch',
    search: query,
    limit: String(MAX_RESULTS),
    namespace: '0',
    format: 'json',
  }).toString()}`;
  const res = await fetch(endpoint, {
    headers: { 'User-Agent': 'llm.christmas-chat/1.0 (https://chat.llm.christmas)' },
  });
  if (!res.ok) throw new Error(`Wikipedia(${lang}) HTTP ${res.status}`);
  const data = (await res.json()) as [string, string[], string[], string[]];
  const titles = data[1] || [];
  const descriptions = data[2] || [];
  const urls = data[3] || [];
  const hits: SearchHit[] = [];
  for (let i = 0; i < titles.length; i++) {
    hits.push(
      trimHit({
        title: titles[i],
        url: urls[i] || '',
        snippet: descriptions[i] || '',
      }),
    );
  }
  if (!hits.length) throw new Error(`Wikipedia(${lang}) returned no results`);
  return hits.filter((h) => h.url);
}

/** Free news RSS — works well from serverless for “最近/最新” queries. */
async function searchGoogleNewsRss(query: string): Promise<SearchHit[]> {
  const url = `https://news.google.com/rss/search?${new URLSearchParams({
    q: query,
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  }).toString()}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'llm.christmas-chat/1.0',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
  });
  if (!res.ok) throw new Error(`Google News RSS HTTP ${res.status}`);
  const xml = await res.text();
  const hits: SearchHit[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let block: RegExpExecArray | null;
  while ((block = itemRe.exec(xml)) && hits.length < MAX_RESULTS) {
    const item = block[1];
    const title = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) ||
      item.match(/<title>([\s\S]*?)<\/title>/i))?.[1];
    const link = (item.match(/<link>([\s\S]*?)<\/link>/i))?.[1];
    const desc = (item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) ||
      item.match(/<description>([\s\S]*?)<\/description>/i))?.[1];
    const cleanTitle = decodeEntities((title || '').replace(/<[^>]+>/g, '').trim());
    const cleanLink = (link || '').trim();
    const cleanSnippet = decodeEntities((desc || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    if (!cleanTitle || !cleanLink) continue;
    hits.push(trimHit({ title: cleanTitle, url: cleanLink, snippet: cleanSnippet }));
  }
  if (!hits.length) throw new Error('Google News RSS returned no results');
  return hits;
}

type Provider = {
  name: string;
  available: () => boolean;
  search: (query: string, freshness?: Freshness | null) => Promise<SearchHit[]>;
};

const PROVIDERS: Provider[] = [
  {
    name: 'zhipu',
    available: () => zhipuMcpEnabled(),
    search: searchZhipu,
  },
  { name: 'tavily', available: () => Boolean(process.env.TAVILY_API_KEY), search: searchTavily },
  {
    name: 'brave',
    available: () => Boolean(process.env.BRAVE_SEARCH_API_KEY),
    search: searchBrave,
  },
  { name: 'serper', available: () => Boolean(process.env.SERPER_API_KEY), search: searchSerper },
  { name: 'google_news', available: () => true, search: (q) => searchGoogleNewsRss(q) },
  { name: 'duckduckgo', available: () => true, search: (q) => searchDuckDuckGo(q) },
  {
    name: 'wikipedia_en',
    available: () => true,
    search: (q) => searchWikipedia(q, 'en'),
  },
  {
    name: 'wikipedia_zh',
    available: () => true,
    search: (q) => searchWikipedia(q, 'zh'),
  },
];

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
    } catch (err: any) {
      const message = err?.message || String(err);
      errors.push(`${provider.name}: ${message}`);
      console.warn(`[web_search] ${provider.name} failed, trying next:`, message);
    }
  }

  return {
    provider: 'none',
    query: q,
    results: [],
    error: errors.join(' | ') || 'All providers failed',
  };
}

export function formatSearchResultsForModel(
  outcome: SearchOutcome,
  opts?: { freshness?: Freshness | null; userAsk?: string },
): string {
  const asOf = new Date().toISOString().slice(0, 10);
  const freshness = opts?.freshness ?? null;
  const windowLabel =
    freshness === 'day'
      ? 'past 24 hours'
      : freshness === 'week'
        ? 'past 7 days'
        : freshness === 'month'
          ? 'recent (prefer last ~30 days)'
          : freshness === 'year'
            ? `year ${asOf.slice(0, 4)}`
            : null;
  const strictWeek = freshness === 'week' || freshness === 'day';

  if (!outcome.results.length) {
    return JSON.stringify({
      ok: false,
      asOf,
      requestedWindow: windowLabel,
      provider: outcome.provider,
      query: outcome.query,
      error: outcome.error || 'No results',
      instructions:
        'Tell the user search failed or returned nothing useful. Do not invent a list from memory.',
    });
  }

  const results = outcome.results.map((r, i) => {
    const annotated = annotateHitFreshness(r, asOf, freshness);
    return {
      rank: i + 1,
      title: annotated.title,
      url: annotated.url,
      snippet: annotated.snippet,
      publishedAt: annotated.publishedAt || null,
      age: annotated.age || null,
      yearHints: annotated.yearHints || [],
      staleHint: Boolean(annotated.staleHint),
    };
  });

  return JSON.stringify({
    ok: true,
    asOf,
    requestedWindow: windowLabel,
    strictWeek,
    userAsk: opts?.userAsk || null,
    provider: outcome.provider,
    query: outcome.query,
    results,
    instructions: [
      'The results array IS the web_search tool output. If results.length > 0, tools DID return data — never claim “no tool results” / “工具未返回”.',
      `asOf=${asOf}. Interpret relative time from the latest message stamp and userAsk — not training cutoff.`,
      strictWeek
        ? 'User explicitly asked for a day/week window. Only call something “this week” if publishedAt/age/title/snippet supports that window.'
        : 'User did NOT necessarily ask for a 7-day window. Prefer fresher sources, but do NOT invent or insist on a “past 7 days / 本周” framing unless userAsk explicitly says 一周/本周/this week.',
      'Missing publishedAt is common — still use title/snippet when relevant; prefer dated items when available.',
      'If staleHint is true, treat as older background or drop it from a “recent” list.',
      'If nothing useful remains after filtering, say so — do not pad with training memory.',
      'Cite markdown links for every project/event you keep.',
    ].join(' '),
  });
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
