import {
  WEB_SEARCH_TOOL,
  formatSearchResultsForModel,
  webSearch,
  type SearchOutcome,
} from '@/lib/tools/search/engine';
import { freshnessForQuery } from '@/lib/chat/time-context';
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

/** Shared search runner used by the registry tool + cursor proactive path. */
export async function runWebSearch(
  query: string,
  ctx: ToolRuntimeContext,
): Promise<SearchOutcome> {
  const q = String(query || '').trim().slice(0, 500);
  const freshness = freshnessForQuery(ctx.userAsk);
  ctx.send({ tool: { status: 'start', name: 'web_search', query: q } });
  const outcome = await webSearch(q, { freshness });
  ctx.send({
    tool: {
      status: 'done',
      name: 'web_search',
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
      const outcome = await runWebSearch(query, ctx);
      return {
        content: formatWebSearchToolContent(outcome, ctx.userAsk),
        data: outcome,
      };
    },
  };
}
