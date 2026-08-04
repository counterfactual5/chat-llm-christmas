import {
  WEB_SEARCH_TOOL,
  formatSearchResultsForModel,
  webSearch,
  type SearchOutcome,
} from '@/lib/tools/search/engine';
import { freshnessForQuery } from '@/lib/chat/context/time-context';
import { normalizeWikiQuery } from '@/lib/tools/search/wiki-query';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';

export function parseSearchQuery(rawArgs: string, fallback: string): string {
  try {
    const args = JSON.parse(rawArgs || '{}');
    const q = String(args?.query || args?.q || '').trim();
    if (q) return q;
  } catch {
    const bare = rawArgs.replace(/^["']|["']$/g, '').trim();
    if (bare) return bare;
  }
  return fallback.slice(0, 200);
}

export function parseSearchSources(
  rawArgs: string,
): 'web' | 'news' | 'wiki' | undefined {
  try {
    const args = JSON.parse(rawArgs || '{}');
    const s = String(args?.sources || args?.source || '')
      .trim()
      .toLowerCase();
    if (s === 'news' || s === 'wiki' || s === 'web') return s;
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Shared search runner used by the registry tool + cursor proactive path. */
export async function runWebSearch(
  query: string,
  ctx: ToolRuntimeContext,
  opts?: { sources?: 'web' | 'news' | 'wiki'; lang?: 'en' | 'zh' | null },
): Promise<SearchOutcome> {
  const sources = opts?.sources || 'web';
  let q = String(query || '').trim().slice(0, 500);
  let wikiLang = opts?.lang === 'en' || opts?.lang === 'zh' ? opts.lang : null;
  if (sources === 'wiki') {
    const normalized = normalizeWikiQuery(q, {
      lang: wikiLang,
      userAsk: ctx.userAsk,
    });
    q = normalized.query;
    wikiLang = normalized.lang;
  }
  const freshness = freshnessForQuery(ctx.userAsk);
  const toolName =
    sources === 'news' ? 'news_search' : sources === 'wiki' ? 'wiki_search' : 'web_search';
  ctx.send({ tool: { status: 'start', name: toolName, query: q } });
  let outcome = await webSearch(q, {
    freshness,
    sources,
    ...(sources === 'wiki' && wikiLang ? { lang: wikiLang } : {}),
    apiKey: ctx.credentials?.skillsApiKey,
  });
  // Bilingual leftovers or wrong edition: retry the other script once.
  if (sources === 'wiki' && !outcome.results.length) {
    const alt = normalizeWikiQuery(String(query || '').trim(), {
      lang: wikiLang === 'zh' ? 'en' : 'zh',
      userAsk: ctx.userAsk,
    });
    if (alt.query && alt.query !== q) {
      const retry = await webSearch(alt.query, {
        freshness,
        sources: 'wiki',
        lang: alt.lang,
        apiKey: ctx.credentials?.skillsApiKey,
      });
      if (retry.results.length) outcome = retry;
    }
  }
  ctx.send({
    tool: {
      status: 'done',
      name: toolName,
      query: outcome.query,
      provider: outcome.provider,
      results: outcome.results,
      error: outcome.error,
    },
  });
  return outcome;
}

export function formatWebSearchToolContent(
  outcome: SearchOutcome,
  userAsk: string,
): string {
  return formatSearchResultsForModel(outcome, {
    freshness: freshnessForQuery(userAsk),
    userAsk,
  });
}

const WEB_SEARCH_SYSTEM_PROMPT = [
  'You have a web_search tool for live web lookup. You decide when to call it — the user does not need to say “搜一下”.',
  'Skip search for stable knowledge you already know well: definitions, “belongs to which field”, classic formulas, textbook accounting/finance/math, settled history.',
  'Do search (without waiting for an explicit search request) when a good answer needs live or post-training facts: news, prices, product versions, “最新/最近/现在怎么样”, people/companies/events that change, docs that may have been updated, or anything you are unsure may be outdated.',
  'Pass sources=news for headlines/breaking news; sources=wiki for encyclopedia/entity verification; otherwise omit or use web.',
  'For sources=wiki, pass a single-language entity name (e.g. 比特币 or Bitcoin — not both) and prefer lang=zh|en matching the user.',
  'If the user explicitly asks to search/look up, call web_search.',
  'After web_search, if you need full article/docs text from a result URL, call web_read on that URL (do not rely on snippets alone for deep details).',
  'Do not pretend to search — if you need the web, call the tool; if you do not need the web, answer directly.',
  'When the query is actually about recent/latest/this week, include a calendar anchor from the latest message timestamp. Never append a year to timeless definition queries.',
  'After tool results arrive, cite title + URL. Do not invent sources.',
  'Do not claim to read local files, run shell, or scan a workspace.',
].join(' ');

export function createWebSearchTool(): ChatTool {
  return {
    name: 'web_search',
    definition: WEB_SEARCH_TOOL,
    systemPrompt: WEB_SEARCH_SYSTEM_PROMPT,
    enabled: (flags) => flags.searchEnabled,
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const query = parseSearchQuery(rawArguments, fallbackQuery || ctx.userAsk);
      const sources = parseSearchSources(rawArguments);
      const outcome = await runWebSearch(query, ctx, sources ? { sources } : undefined);
      return {
        content: formatWebSearchToolContent(outcome, ctx.userAsk),
        data: outcome,
      };
    },
  };
}
