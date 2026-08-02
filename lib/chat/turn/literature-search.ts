/**
 * `/papers` + `/books` turn planning + chat-api literature search.
 */

import type { Message, MessageToolRun } from '@/lib/chat/types';
import { titleForNewConversation } from '@/lib/chat/turn/attachments';
import {
  formatLiteratureCommand,
  type LiteratureKind,
} from '@/lib/chat/turn/literature-command';

export type LiteratureHit = {
  title: string;
  url: string;
  snippet?: string;
  authors?: string;
  year?: string;
  sourceProvider?: string;
  sourceKind?: string;
  doi?: string;
  archiveId?: string;
  downloadable?: boolean;
};

export type LiteratureSearchResult =
  | {
      ok: true;
      kind: LiteratureKind;
      query: string;
      provider: string;
      results: LiteratureHit[];
    }
  | { ok: false; error: string };

export type LiteratureThread = {
  thread: Message[];
  assistantId: string;
  newTitle?: string;
};

export function buildLiteratureSearchThread(opts: {
  kind: LiteratureKind;
  query: string;
  cleanedBase: Message[];
  skipDuplicateUser?: boolean;
  currentTitle?: string;
  now?: () => number;
  genId?: () => string;
}): LiteratureThread {
  const now = opts.now ?? Date.now;
  const genId = opts.genId ?? (() => crypto.randomUUID());
  const command = formatLiteratureCommand(opts.kind, opts.query);
  const assistantId = genId();
  const assistantMessage: Message = {
    id: assistantId,
    role: 'assistant',
    content: opts.kind === 'books' ? 'Searching books…' : 'Searching papers…',
    timestamp: now(),
    incomplete: true,
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

  return { thread, assistantId, newTitle };
}

export type BookDownloadResult =
  | {
      ok: true;
      identifier: string;
      title: string;
      filename: string;
      fileId: string;
      bytes: number;
      sourceUrl: string;
    }
  | { ok: false; error: string };

export async function requestBookDownload(
  identifier: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<BookDownloadResult> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const res = await doFetch('/api/literature/books/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
  const raw = await res.text();
  let data: {
    ok?: boolean;
    error?: string;
    message?: string;
    identifier?: string;
    title?: string;
    filename?: string;
    bytes?: number;
    sourceUrl?: string;
    file?: { id?: string };
  } = {};
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {};
  } catch {
    return {
      ok: false,
      error: raw.trim().slice(0, 400) || `Download API returned non-JSON (HTTP ${res.status})`,
    };
  }
  if (!res.ok || !data.file?.id) {
    return {
      ok: false,
      error: data.error || data.message || `Book download failed (HTTP ${res.status})`,
    };
  }
  return {
    ok: true,
    identifier: String(data.identifier || identifier),
    title: String(data.title || data.filename || identifier),
    filename: String(data.filename || 'book.bin'),
    fileId: String(data.file.id),
    bytes: Number(data.bytes) || 0,
    sourceUrl: String(data.sourceUrl || ''),
  };
}

export async function requestLiteratureSearch(
  kind: LiteratureKind,
  query: string,
  opts?: { fetchImpl?: typeof fetch; limit?: number },
): Promise<LiteratureSearchResult> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const path = kind === 'books' ? '/api/literature/books' : '/api/literature/papers';
  const res = await doFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: opts?.limit ?? 12 }),
  });
  const raw = await res.text();
  let data: {
    ok?: boolean;
    error?: string;
    message?: string;
    provider?: string;
    results?: LiteratureHit[];
    query?: string;
  } = {};
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {};
  } catch {
    return {
      ok: false,
      error: raw.trim().slice(0, 400) || `Literature API returned non-JSON (HTTP ${res.status})`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || data.message || `Literature search failed (HTTP ${res.status})`,
    };
  }
  return {
    ok: true,
    kind,
    query: String(data.query || query),
    provider: String(data.provider || 'none'),
    results: Array.isArray(data.results) ? data.results : [],
  };
}

export function formatLiteratureMarkdown(
  kind: LiteratureKind,
  query: string,
  provider: string,
  results: LiteratureHit[],
): string {
  const heading = kind === 'books' ? 'Books' : 'Papers';
  if (!results.length) {
    return `### ${heading}\n\nNo results for **${query}**.`;
  }
  const lines = [
    `### ${heading}`,
    '',
    `Query: **${query}** · via \`${provider}\``,
    '',
  ];
  results.forEach((hit, i) => {
    const meta = [hit.authors, hit.year, hit.sourceProvider].filter(Boolean).join(' · ');
    lines.push(`${i + 1}. [${hit.title || hit.url}](${hit.url})`);
    if (meta) lines.push(`   - ${meta}`);
    if (hit.snippet) lines.push(`   - ${hit.snippet.replace(/\s+/g, ' ').slice(0, 280)}`);
    if (kind === 'books' && hit.downloadable && hit.archiveId) {
      lines.push('   - Legal download: `/books download ' + hit.archiveId + '`');
    }
    if (hit.doi) lines.push(`   - DOI: \`${hit.doi}\``);
    lines.push('');
  });
  return lines.join('\n').trim();
}

export function literatureToolRun(
  kind: LiteratureKind,
  query: string,
  provider: string,
  results: LiteratureHit[],
  error?: string,
): MessageToolRun {
  return {
    id: crypto.randomUUID(),
    name: kind === 'books' ? 'book_search' : 'paper_search',
    status: 'done',
    query,
    provider,
    results: results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet || '',
    })),
    error,
  };
}
