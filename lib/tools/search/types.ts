/**
 * Shared web_search types and result limits.
 */

import type { Freshness } from '@/lib/chat/context/time-context';

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
  /** Search path: web (default), news, or wiki. */
  sources?: 'web' | 'news' | 'wiki' | null;
  /** Wikipedia language for sources=wiki (chat-api wiki_search). */
  lang?: 'en' | 'zh' | null;
};

export const MAX_RESULTS = 8;
