import {
  WEB_SEARCH_TOOL,
  formatSearchResultsForModel,
  webSearch,
  type SearchOutcome,
} from '@/lib/web-search';
import { freshnessForQuery } from '@/lib/time-context';
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
  'You have a web_search tool for live web lookup.',
  'Call web_search when the user asks to look something up, wants recent/current facts, news, prices, or anything that may have changed after your training data.',
  'Do not pretend to search — if you need the web, call the tool.',
  'When building a search query for “recent/latest/this week”, include an explicit calendar anchor from the latest message timestamp (year/month or ISO date).',
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
