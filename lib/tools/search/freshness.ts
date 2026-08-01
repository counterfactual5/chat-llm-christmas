/**
 * Hit trimming + freshness annotation for web_search results.
 */

import type { Freshness } from '@/lib/chat/context/time-context';
import type { SearchHit } from '@/lib/tools/search/types';

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function trimHit(hit: SearchHit): SearchHit {
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

export { decodeEntities };
