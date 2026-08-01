/**
 * Serialize web_search outcomes for the model tool message.
 */

import type { Freshness } from '@/lib/chat/context/time-context';
import { annotateHitFreshness } from '@/lib/tools/search/freshness';
import type { SearchOutcome } from '@/lib/tools/search/types';

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

