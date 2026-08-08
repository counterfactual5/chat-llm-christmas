/**
 * `/papers` + `/books` turn planning + chat-api literature search.
 */

import type { Message, MessageToolRun } from '@/lib/chat/types';
import { titleForNewConversation } from '@/lib/chat/turn/attachments';
import {
  bookDownloadCommandLabel,
  formatBookDownloadCommand,
  formatLiteratureCommand,
  formatPaperActionCommand,
  formatPaperDownloadCommand,
  isValidBookDownloadIdentifier,
  isValidPaperDownloadIdentifier,
  markdownLinkLabel,
  resolveBookDownloadIdentifier,
  resolvePaperActionId,
  resolvePaperDownloadIdentifier,
  type BookSource,
  type LiteratureKind,
  type PaperAction,
  type PaperSource,
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
  downloadUrl?: string;
  paperId?: string;
  citationCount?: number;
  venue?: string;
  tldr?: string;
  /** Full abstract when present (details responses). */
  abstract?: string;
  pdfUrl?: string;
  format?: string;
  category?: string;
  md5?: string;
  size?: string;
  /** Same title+author, different format / mirror — kept after API-side dedupe. */
  alternates?: Array<{
    format?: string;
    size?: string;
    md5?: string;
    archiveId?: string;
    downloadUrl?: string;
    url?: string;
    sourceProvider?: string;
  }>;
};

export type LiteratureSearchResult =
  | {
      ok: true;
      kind: LiteratureKind;
      query: string;
      provider: string;
      results: LiteratureHit[];
      authors?: AuthorHit[];
      paper?: LiteratureHit & { abstract?: string; externalIds?: Record<string, string> };
    }
  | { ok: false; error: string };

export type AuthorHit = {
  authorId?: string;
  name: string;
  affiliations?: string[];
  paperCount?: number;
  citationCount?: number;
  hIndex?: number;
  url?: string;
};

export type LiteratureThread = {
  thread: Message[];
  assistantId: string;
  toolRunId: string;
  newTitle?: string;
};

export function buildLiteratureSearchThread(opts: {
  kind: LiteratureKind;
  query: string;
  cleanedBase: Message[];
  skipDuplicateUser?: boolean;
  currentTitle?: string;
  source?: string;
  action?: string;
  now?: () => number;
  genId?: () => string;
}): LiteratureThread {
  const now = opts.now ?? Date.now;
  const genId = opts.genId ?? (() => crypto.randomUUID());
  const command = formatLiteratureCommand(opts.kind, opts.query, {
    source: opts.source,
    action: opts.action,
  });
  const assistantId = genId();
  const toolRunId = genId();
  const toolName = opts.kind === 'books' ? 'book_search' : 'paper_search';
  // Empty body — progress lives under Process via toolRuns (like web_search).
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

export type BookDownloadResult =
  | {
      ok: true;
      identifier: string;
      title: string;
      filename: string;
      fileId: string;
      bytes: number;
      sourceUrl: string;
      provider?: string;
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
    provider?: string;
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
    provider: data.provider ? String(data.provider) : undefined,
  };
}

export type PaperDownloadResult =
  | {
      ok: true;
      identifier: string;
      title: string;
      filename: string;
      fileId: string;
      bytes: number;
      sourceUrl: string;
      provider?: string;
    }
  | { ok: false; error: string };

export async function requestPaperDownload(
  identifier: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<PaperDownloadResult> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const res = await doFetch('/api/literature/papers/download', {
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
    provider?: string;
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
      error: data.error || data.message || `Paper download failed (HTTP ${res.status})`,
    };
  }
  return {
    ok: true,
    identifier: String(data.identifier || identifier),
    title: String(data.title || data.filename || identifier),
    filename: String(data.filename || 'paper.pdf'),
    fileId: String(data.file.id),
    bytes: Number(data.bytes) || 0,
    sourceUrl: String(data.sourceUrl || ''),
    provider: data.provider ? String(data.provider) : undefined,
  };
}

export type LiteratureSearchOpts = {
  fetchImpl?: typeof fetch;
  limit?: number;
  source?: PaperSource | BookSource | string;
  action?: PaperAction;
  paperId?: string;
  category?: string;
  year?: string;
  fieldsOfStudy?: string;
  sort?: string;
  oa?: boolean;
  lang?: string;
};

function papersPathForAction(action?: PaperAction): string {
  switch (action) {
    case 'details':
      return '/api/literature/papers/details';
    case 'citations':
      return '/api/literature/papers/citations';
    case 'references':
      return '/api/literature/papers/references';
    case 'author':
      return '/api/literature/papers/author';
    default:
      return '/api/literature/papers';
  }
}

export async function requestLiteratureSearch(
  kind: LiteratureKind,
  query: string,
  opts?: LiteratureSearchOpts,
): Promise<LiteratureSearchResult> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const action = opts?.action || 'search';
  const path =
    kind === 'books' ? '/api/literature/books' : papersPathForAction(action);

  const body: Record<string, unknown> = {
    query,
    limit: opts?.limit ?? 12,
  };
  if (opts?.source && opts.source !== 'auto') body.source = opts.source;
  if (opts?.paperId) body.paperId = opts.paperId;
  if (opts?.category) body.category = opts.category;
  if (opts?.year) body.year = opts.year;
  if (opts?.fieldsOfStudy) body.fieldsOfStudy = opts.fieldsOfStudy;
  if (opts?.sort) body.sort = opts.sort;
  if (opts?.oa) body.oa = true;
  if (opts?.lang) body.lang = opts.lang;
  if (action === 'author') body.name = query;
  if (action === 'details' || action === 'citations' || action === 'references') {
    body.paperId = opts?.paperId || query;
  }

  const res = await doFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data: {
    ok?: boolean;
    error?: string;
    message?: string;
    provider?: string;
    results?: LiteratureHit[];
    authors?: AuthorHit[];
    paper?: LiteratureHit & { abstract?: string; externalIds?: Record<string, string> };
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

  if (action === 'author') {
    return {
      ok: true,
      kind,
      query: String(data.query || query),
      provider: 'semantic-scholar',
      results: [],
      authors: Array.isArray(data.authors) ? data.authors : [],
    };
  }

  if (action === 'details' && data.paper) {
    return {
      ok: true,
      kind,
      query: String(data.paper.paperId || query),
      provider: String(data.paper.sourceProvider || 'semantic-scholar'),
      results: [data.paper],
      paper: data.paper,
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
  extras?: { authors?: AuthorHit[]; action?: PaperAction },
): string {
  if (extras?.action === 'author' && extras.authors) {
    if (!extras.authors.length) {
      return `### Authors\n\nNo authors found for **${query}**.`;
    }
    const lines = [`### Authors`, '', `Query: **${query}**`, ''];
    extras.authors.forEach((a, i) => {
      const aff = a.affiliations?.slice(0, 2).join(', ');
      const detail = [
        a.paperCount != null ? `${a.paperCount} papers` : '',
        a.citationCount != null ? `${a.citationCount} citations` : '',
        a.hIndex != null ? `h-index ${a.hIndex}` : '',
        a.authorId ? `ID: \`${a.authorId}\`` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const name = a.url ? `[${a.name}](${a.url})` : a.name;
      lines.push(`${i + 1}. ${name}${aff ? ` (${aff})` : ''}`);
      lines.push('');
      if (detail) lines.push(detail);
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  const heading =
    extras?.action === 'citations'
      ? 'Citations'
      : extras?.action === 'references'
        ? 'References'
        : extras?.action === 'details'
          ? 'Paper details'
          : kind === 'books'
            ? 'Books'
            : 'Papers';

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
    // Shape: numbered hit (title + meta via hard breaks), then nested
    // unordered list of slash commands — one command per bullet.
    const blocks: string[] = [
      `[${hit.title || hit.url}](${hit.url || hit.pdfUrl || '#'})`,
    ];

    const meta: string[] = [
      hit.authors,
      hit.year,
      hit.venue,
      hit.citationCount != null ? `${hit.citationCount} citations` : '',
      hit.sourceProvider,
      hit.format,
      hit.size,
      hit.doi ? `DOI: \`${hit.doi}\`` : '',
    ].filter(Boolean) as string[];

    if (kind === 'papers') {
      const actionId = resolvePaperActionId(hit);
      if (actionId) meta.push(`ID: \`${actionId}\``);
      if (extras?.action !== 'details') {
        const blurb = (hit.tldr || hit.snippet || '').replace(/\s+/g, ' ').trim();
        if (blurb && blurb.length <= 160) {
          meta.push(hit.tldr ? `TLDR: ${blurb}` : blurb);
        }
      }
    }

    if (meta.length) blocks.push(meta.join(' · '));

    if (kind === 'papers' && extras?.action === 'details') {
      const body = String(hit.abstract || hit.tldr || hit.snippet || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (body) blocks.push(body);
    }

    const cmds: string[] = [];
    if (kind === 'papers') {
      const actionId = resolvePaperActionId(hit);
      if (actionId) {
        cmds.push(`\`${formatPaperActionCommand('details', actionId)}\``);
        cmds.push(`\`${formatPaperActionCommand('citations', actionId)}\``);
        cmds.push(`\`${formatPaperActionCommand('references', actionId)}\``);
      }
      const dlId = resolvePaperDownloadIdentifier(hit);
      if (dlId && isValidPaperDownloadIdentifier(dlId)) {
        cmds.push(`\`${formatPaperDownloadCommand(dlId)}\``);
      } else if (hit.pdfUrl) {
        cmds.push(`PDF: [Open PDF](${hit.pdfUrl})`);
      }
    }

    if (kind === 'books') {
      const dlId = hit.downloadable ? resolveBookDownloadIdentifier(hit) : '';
      if (dlId && isValidBookDownloadIdentifier(dlId)) {
        cmds.push(
          `${bookDownloadCommandLabel(dlId)}: \`${formatBookDownloadCommand(dlId)}\``,
        );
      } else if (hit.url && /^https?:\/\//i.test(hit.url)) {
        const label = markdownLinkLabel(hit.title || '', 'Page');
        cmds.push(`Manual download: [${label}](${hit.url})`);
      }
      const alt = (hit.alternates || []).find((a) => {
        const altId = resolveBookDownloadIdentifier(a);
        return Boolean(altId && isValidBookDownloadIdentifier(altId));
      });
      if (alt) {
        const altId = resolveBookDownloadIdentifier(alt)!;
        const bits = [alt.format, alt.size].filter(Boolean).join(' · ');
        cmds.push(
          `Alt download${bits ? ` (${bits})` : ''}: \`${formatBookDownloadCommand(altId)}\``,
        );
      }
    }

    // Nested bullets under the ordered item (3-space indent after `1. `).
    let item = `${i + 1}. ${blocks.join('  \n')}`;
    if (cmds.length) {
      item += `\n\n${cmds.map((c) => `   - ${c}`).join('\n')}`;
    }
    lines.push(item);
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
      snippet: r.snippet || r.tldr || '',
    })),
    error,
  };
}
