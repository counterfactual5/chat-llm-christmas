/**
 * `/news` + `/wiki` turn planning + chat-api source-lane search.
 */

import type { Message } from '@/lib/chat/types';
import { titleForNewConversation } from '@/lib/chat/turn/attachments';
import {
  formatSourceSearchCommand,
  type SourceSearchKind,
} from '@/lib/chat/turn/source-search-command';
import type { SearchHit, SearchOutcome } from '@/lib/tools/search/types';
import { formatSearchResultsForModel } from '@/lib/tools/search/format';

export type SourceSearchThread = {
  thread: Message[];
  assistantId: string;
  toolRunId: string;
  newTitle?: string;
};

export function buildSourceSearchThread(opts: {
  kind: SourceSearchKind;
  query: string;
  cleanedBase: Message[];
  skipDuplicateUser?: boolean;
  currentTitle?: string;
  lang?: 'en' | 'zh';
  now?: () => number;
  genId?: () => string;
}): SourceSearchThread {
  const now = opts.now ?? Date.now;
  const genId = opts.genId ?? (() => crypto.randomUUID());
  const command = formatSourceSearchCommand(opts.kind, opts.query, { lang: opts.lang });
  const assistantId = genId();
  const toolRunId = genId();
  const toolName = opts.kind === 'news' ? 'news_search' : 'wiki_search';
  const assistantMessage: Message = {
    id: assistantId,
    role: 'assistant',
    content: '',
    timestamp: now(),
    incomplete: true,
    toolRuns: [
      {
        id: toolRunId,
        name: toolName,
        status: 'start',
        query: opts.query,
      },
    ],
    activity: [{ id: genId(), kind: 'tool', toolRunId }],
  };

  let newTitle = opts.currentTitle;
  if (
    opts.cleanedBase.length === 0 ||
    (opts.cleanedBase.length === 1 && opts.skipDuplicateUser)
  ) {
    newTitle = titleForNewConversation(opts.query);
  }

  const thread = opts.skipDuplicateUser
    ? [...opts.cleanedBase, assistantMessage]
    : [
        ...opts.cleanedBase,
        {
          id: genId(),
          role: 'user' as const,
          content: command,
          timestamp: now(),
        },
        assistantMessage,
      ];

  return { thread, assistantId, toolRunId, newTitle };
}

export async function requestSourceSearch(
  kind: SourceSearchKind,
  query: string,
  opts?: { lang?: 'en' | 'zh'; fetchImpl?: typeof fetch },
): Promise<SearchOutcome> {
  const q = String(query || '').trim().slice(0, 500);
  const doFetch = opts?.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    query: q,
    sources: kind,
  };
  if (kind === 'wiki' && opts?.lang) body.lang = opts.lang;
  try {
    const res = await doFetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      provider?: string;
      query?: string;
      results?: SearchHit[];
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

export function formatSourceSearchMarkdown(
  kind: SourceSearchKind,
  outcome: SearchOutcome,
  userAsk: string,
): string {
  if (outcome.error && !outcome.results.length) {
    return `**${kind === 'news' ? 'News' : 'Wiki'} search failed:** ${outcome.error}`;
  }
  return formatSearchResultsForModel(outcome, { userAsk });
}

export function sourceSearchToolRun(
  kind: SourceSearchKind,
  query: string,
  provider: string,
  results: SearchHit[],
) {
  return {
    name: kind === 'news' ? 'news_search' : 'wiki_search',
    provider,
    query,
    results,
  };
}
