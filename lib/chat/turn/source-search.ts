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

export type SourceSearchThread = {
  thread: Message[];
  assistantId: string;
  toolRunId: string;
  newTitle?: string;
};

/** Strip provider HTML (Google News snippets often wrap <a>/<font>). */
export function stripSearchSnippetHtml(raw: string): string {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSourceSearchThread(opts: {
  kind: SourceSearchKind;
  query: string;
  cleanedBase: Message[];
  skipDuplicateUser?: boolean;
  currentTitle?: string;
  lang?: 'en' | 'zh';
  /**
   * When false (default for the chat tool-loop path), do not invent a client
   * tool card — the server emits the real news_search / wiki_search SSE.
   */
  withClientToolPlaceholder?: boolean;
  now?: () => number;
  genId?: () => string;
}): SourceSearchThread {
  const now = opts.now ?? Date.now;
  const genId = opts.genId ?? (() => crypto.randomUUID());
  const command = formatSourceSearchCommand(opts.kind, opts.query, { lang: opts.lang });
  const assistantId = genId();
  const toolRunId = genId();
  const toolName = opts.kind === 'news' ? 'news_search' : 'wiki_search';
  const withPlaceholder = opts.withClientToolPlaceholder === true;
  const assistantMessage: Message = {
    id: assistantId,
    role: 'assistant',
    content: '',
    timestamp: now(),
    incomplete: true,
    ...(withPlaceholder
      ? {
          toolRuns: [
            {
              id: toolRunId,
              name: toolName,
              status: 'start' as const,
              query: opts.query,
            },
          ],
          activity: [{ id: genId(), kind: 'tool' as const, toolRunId }],
        }
      : {}),
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

/**
 * Human-facing markdown for the chat bubble (not the model tool JSON).
 * Empty hits stay soft tips; hits become a linked list with HTML stripped.
 */
export function formatSourceSearchMarkdown(
  kind: SourceSearchKind,
  outcome: SearchOutcome,
  userAsk: string,
): string {
  const ask = String(userAsk || outcome.query || '').trim();
  if (outcome.error && !outcome.results.length) {
    const label = kind === 'news' ? 'News' : 'Wiki';
    const tip =
      kind === 'wiki'
        ? '维基百科适合查实体词条（如「人工智能」「量子计算」）。试试更具体的主题，或用 `/wiki zh …` / `/wiki en …` 指定语言。'
        : '新闻检索适合具体话题（如「人工智能」「美联储」）。换一个更具体的关键词再试。';
    return [
      `**${label}：** 没有找到与「${ask}」匹配的结果。`,
      '',
      tip,
      outcome.error ? `\n_(${outcome.error})_` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const heading = kind === 'news' ? 'News' : 'Wikipedia';
  const lines = [
    `### ${heading}`,
    '',
    `Query: **${ask || outcome.query}** · via \`${outcome.provider}\``,
    '',
  ];
  for (let i = 0; i < outcome.results.length; i++) {
    const hit = outcome.results[i]!;
    const title = stripSearchSnippetHtml(hit.title) || hit.url || `Result ${i + 1}`;
    const url = String(hit.url || '').trim();
    lines.push(url ? `${i + 1}. [${title}](${url})` : `${i + 1}. ${title}`);
    const meta = [hit.publishedAt, hit.age].filter(Boolean).join(' · ');
    if (meta) lines.push(`   - ${meta}`);
    const snip = stripSearchSnippetHtml(hit.snippet);
    if (snip) lines.push(`   - ${snip.slice(0, 280)}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

/**
 * Compact, HTML-free hit list for the polish model (never the tool JSON
 * envelope — weak models echo `{"ok":true,...instructions}` into the bubble).
 */
export function formatSourceSearchHitsForPolish(
  outcome: SearchOutcome,
  limit = 8,
): string {
  const lines: string[] = [];
  for (let i = 0; i < Math.min(outcome.results.length, limit); i++) {
    const hit = outcome.results[i]!;
    const title = stripSearchSnippetHtml(hit.title) || `Result ${i + 1}`;
    const url = String(hit.url || '').trim();
    const meta = [hit.publishedAt, hit.age].filter(Boolean).join(' · ');
    const snip = stripSearchSnippetHtml(hit.snippet).slice(0, 220);
    lines.push(`${i + 1}. ${title}`);
    if (url) lines.push(`   URL: ${url}`);
    if (meta) lines.push(`   When: ${meta}`);
    if (snip) lines.push(`   Snippet: ${snip}`);
  }
  return lines.join('\n').trim();
}

/** Prompt for a tools-off LLM pass that turns hits into a readable briefing. */
export function buildSourceSearchPolishPrompt(
  kind: SourceSearchKind,
  userAsk: string,
  outcome: SearchOutcome,
): string {
  const ask = String(userAsk || outcome.query || '').trim();
  const role =
    kind === 'news'
      ? 'Write a concise news briefing from the search hits below.'
      : 'Write a concise encyclopedia-style answer from the Wikipedia/search hits below.';
  return [
    role,
    'Match the user language. Use Markdown with clear headings and bullets.',
    'Cite markdown links for every item you keep (use the URL lines). Prefer dated items when available.',
    'Do not invent facts beyond the hits. Do not call tools.',
    'CRITICAL: Output ONLY the briefing. Never reprint the hit list verbatim as a raw dump, never output JSON, never output HTML tags, never mention “tool payload” / instructions / asOf / strictWeek.',
    '',
    `User ask: ${ask}`,
    `Provider: ${outcome.provider}`,
    '',
    '## Hits',
    formatSourceSearchHitsForPolish(outcome),
  ].join('\n');
}

/**
 * Drop leaked tool JSON / HTML that weak models copy from the polish context.
 * Returns null when the reply is unusable and the caller should use fallback.
 */
export function sanitizeSourceSearchPolish(text: string): string | null {
  let out = String(text || '').trim();
  if (!out) return null;

  // Truncate at a dumped tool-envelope JSON object.
  const jsonDump = out.search(/\{\s*"ok"\s*:/);
  if (jsonDump >= 0) {
    out = out.slice(0, jsonDump).trim();
  }
  // Or a fenced ```json block that is clearly the envelope.
  out = out.replace(/```(?:json)?\s*\{\s*"ok"\s*:[\s\S]*?```/gi, '').trim();
  out = out.replace(/```(?:json)?\s*\{\s*"ok"\s*:[\s\S]*$/gi, '').trim();

  if (!out || /^Error:/i.test(out)) return null;
  // Mostly machine dump still.
  if (/"ok"\s*:\s*true/.test(out) && /"results"\s*:/.test(out)) return null;
  if ((out.match(/<a\s+href=/gi) || []).length >= 2) return null;
  return out;
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
