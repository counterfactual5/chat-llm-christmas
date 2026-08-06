/**
 * Model-callable literature tools: paper_search + book_search.
 * Backed by chat-api `/v1/literature/*` (same stack as `/papers` `/books` commands).
 */

import { chatBackendLiteratureURL } from '@/lib/chat-backend';
import {
  formatBookDownloadCommand,
  formatPaperActionCommand,
  formatPaperDownloadCommand,
  isValidBookDownloadIdentifier,
  isValidPaperDownloadIdentifier,
  resolveBookDownloadIdentifier,
  resolvePaperDownloadIdentifier,
} from '@/lib/chat/turn/literature-command';
import {
  formatLiteratureMarkdown,
  type LiteratureHit,
} from '@/lib/chat/turn/literature-search';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';

function parseQuery(
  rawArguments: string,
  fallback: string,
): {
  query: string;
  source?: string;
  limit: number;
} {
  let args: { query?: string; q?: string; source?: string; limit?: number } = {};
  try {
    args = JSON.parse(rawArguments || '{}') || {};
  } catch {
    const bare = String(rawArguments || '')
      .replace(/^["']|["']$/g, '')
      .trim();
    if (bare) return { query: bare.slice(0, 300), limit: 10 };
  }
  const query = String(args.query || args.q || fallback || '')
    .trim()
    .slice(0, 300);
  const source = String(args.source || '')
    .trim()
    .toLowerCase();
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
  return { query, source: source && source !== 'auto' ? source : undefined, limit };
}

async function fetchLiterature(
  kind: 'papers' | 'books',
  opts: { query: string; source?: string; limit: number },
  ctx: ToolRuntimeContext,
): Promise<{
  ok: boolean;
  provider: string;
  results: LiteratureHit[];
  error?: string;
}> {
  const apiKey = ctx.credentials?.skillsApiKey;
  if (!apiKey) {
    return {
      ok: false,
      provider: 'none',
      results: [],
      error: 'Literature search requires a connected account',
    };
  }
  const path = kind === 'books' ? 'books' : 'papers';
  const body: Record<string, unknown> = {
    query: opts.query,
    limit: opts.limit,
  };
  if (opts.source) body.source = opts.source;

  const res = await fetch(chatBackendLiteratureURL(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(kind === 'books' ? 25_000 : 30_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
    provider?: string;
    results?: LiteratureHit[];
  };
  if (!res.ok) {
    return {
      ok: false,
      provider: String(data.provider || 'none'),
      results: [],
      error: data.error || data.message || `HTTP ${res.status}`,
    };
  }
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    ok: true,
    provider: String(data.provider || kind),
    results,
  };
}

/** Shared answer-shape contract for book_search / paper_search (matches /books / /papers). */
export const LITERATURE_TOOL_ANSWER_HINT = {
  books:
    'Prefer copying answerMarkdown verbatim for the results list (same shape as /books). ' +
    'Each hit: numbered title markdown link, optional meta line, then on its own line ' +
    'Download: `/books download …` with the exact downloadCommand in backticks (required for clickable UI buttons). ' +
    'Put a blank line between numbered hits (after Download / Manual download, before the next `N.`) so items do not run together. ' +
    'Only use downloadCommand / alternateDownloads from this receipt — never invent md5 or archive ids, ' +
    'never bury commands in em-dash prose or narrative sentences. ' +
    'If downloadCommand is missing, use Manual download: [title](url).',
  papers:
    'Prefer copying answerMarkdown verbatim for the results list (same shape as /papers). ' +
    'Each hit: numbered title markdown link, optional meta/TLDR, then Actions / Download lines with ' +
    'exact receipt commands in backticks (required for clickable UI buttons). ' +
    'Put a blank line between numbered hits so items do not run together. ' +
    'When downloadCommand is present, show Download: `<downloadCommand>` — that stores the PDF in Files; ' +
    'do not turn an external URL into a “download” link. ' +
    'Never invent ids or bury commands in em-dash prose. ' +
    'When only pdfUrl is present (no downloadCommand), link it as Open PDF in the browser.',
} as const;

/** Shape tool receipts so the model can cite real download / paper-action commands. */
export function formatHitsForModel(
  kind: 'papers' | 'books',
  query: string,
  provider: string,
  results: LiteratureHit[],
): string {
  const answerMarkdown = formatLiteratureMarkdown(kind, query, provider, results);

  if (!results.length) {
    return JSON.stringify({
      ok: true,
      kind,
      query,
      provider,
      results: [],
      answerMarkdown,
      note: 'No results. Try a different query or source.',
      hint: LITERATURE_TOOL_ANSWER_HINT[kind],
    });
  }

  if (kind === 'books') {
    return JSON.stringify({
      ok: true,
      kind,
      query,
      provider,
      results: results.slice(0, 12).map((r) => {
        const downloadable = Boolean(r.downloadable);
        const resolved = downloadable ? resolveBookDownloadIdentifier(r) : '';
        const downloadCommand =
          resolved && isValidBookDownloadIdentifier(resolved)
            ? formatBookDownloadCommand(resolved)
            : undefined;
        const alternateDownloads = (r.alternates || [])
          .map((alt) => {
            const id = resolveBookDownloadIdentifier(alt);
            if (!id || !isValidBookDownloadIdentifier(id)) return null;
            return {
              format: alt.format,
              size: alt.size,
              downloadCommand: formatBookDownloadCommand(id),
            };
          })
          .filter(Boolean);
        return {
          title: r.title || '',
          url: r.url || '',
          snippet: r.snippet || r.tldr || '',
          authors: r.authors,
          year: r.year,
          source: r.sourceProvider,
          downloadable,
          downloadCommand,
          size: r.size,
          format: r.format,
          alternateDownloads: alternateDownloads.length
            ? alternateDownloads
            : undefined,
        };
      }),
      answerMarkdown,
      hint: LITERATURE_TOOL_ANSWER_HINT.books,
    });
  }

  return JSON.stringify({
    ok: true,
    kind,
    query,
    provider,
    results: results.slice(0, 12).map((r) => {
      const paperId = r.paperId ? String(r.paperId) : undefined;
      const resolved = resolvePaperDownloadIdentifier(r);
      const downloadCommand =
        resolved && isValidPaperDownloadIdentifier(resolved)
          ? formatPaperDownloadCommand(resolved)
          : undefined;
      return {
        title: r.title || '',
        url: r.url || '',
        snippet: r.snippet || r.tldr || '',
        authors: r.authors,
        year: r.year,
        source: r.sourceProvider,
        paperId,
        // Only expose pdfUrl when API download is unavailable — otherwise models
        // turn it into a “下载” markdown link and skip /papers download → Files.
        ...(downloadCommand
          ? { downloadCommand }
          : r.pdfUrl
            ? { pdfUrl: r.pdfUrl }
            : {}),
        detailsCommand: paperId ? formatPaperActionCommand('details', paperId) : undefined,
        citationsCommand: paperId
          ? formatPaperActionCommand('citations', paperId)
          : undefined,
        referencesCommand: paperId
          ? formatPaperActionCommand('references', paperId)
          : undefined,
      };
    }),
    answerMarkdown,
    hint: LITERATURE_TOOL_ANSWER_HINT.papers,
  });
}

export const PAPER_SYSTEM = [
  'You have a paper_search tool for academic papers (arXiv / Semantic Scholar / OpenAlex).',
  'Call it when the user asks for papers, research literature, citations, or scholarly work — do not invent paper titles/DOIs.',
  'Prefer paper_search over web_search for academic literature.',
  'After results, reply with a numbered list matching answerMarkdown / the /papers slash shape: title link, meta, then Actions and Download lines with commands in backticks — never invent ids, never bury commands in em-dash prose.',
  'Put a blank line between numbered hits (do not pack `N.` items back-to-back).',
  'Copy exact receipt fields (detailsCommand / citationsCommand / referencesCommand / downloadCommand) as inline code so they become clickable buttons.',
  'downloadCommand saves the PDF into the user Files store (in-app). When a hit has downloadCommand, show Download: `<downloadCommand>` — do not turn an external URL into a “download” link.',
  'Only when a hit has pdfUrl and no downloadCommand, link pdfUrl as Open PDF in the browser.',
].join(' ');

export const BOOK_SYSTEM = [
  'You have a book_search tool for books (LibGen / Internet Archive / Open Library / Gutenberg / catalogs).',
  'Call it when the user asks to find books or ebooks. Prefer book_search over web_search for book lookup.',
  'After results, reply with a numbered list matching answerMarkdown / the /books slash shape: title markdown link, optional meta, then Download: `/books download …` with the exact downloadCommand in backticks (clickable button) — never invent identifiers, never bury commands in em-dash prose.',
  'Put a blank line between numbered hits (after each Download / Manual download line, before the next `N.`) so entries do not run together.',
  'When downloadCommand is absent, use Manual download: [title](url). Prefer copying answerMarkdown from the receipt when present.',
  'Never invent catalog entries; only cite title + URL and commands from the tool receipt.',
].join(' ');

export function createPaperSearchTool(): ChatTool {
  return {
    name: 'paper_search',
    definition: {
      type: 'function',
      function: {
        name: 'paper_search',
        description:
          'Search academic papers (arXiv, Semantic Scholar, OpenAlex). Use for scholarly literature, not general web news.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (title, topic, keywords).' },
            source: {
              type: 'string',
              description: 'Optional: arxiv | semantic | openalex',
            },
            limit: { type: 'number', description: 'Max results (1–20, default 10).' },
          },
          required: ['query'],
        },
      },
    },
    systemPrompt: PAPER_SYSTEM,
    enabled: (flags) => flags.integrations.includes('paper_search'),
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const { query, source, limit } = parseQuery(
        rawArguments,
        fallbackQuery || ctx.userAsk,
      );
      if (!query) {
        const error = 'paper_search requires a query';
        ctx.send({ tool: { status: 'done', name: 'paper_search', error } });
        return { content: JSON.stringify({ ok: false, error }) };
      }
      ctx.send({ tool: { status: 'start', name: 'paper_search', query } });
      const outcome = await fetchLiterature('papers', { query, source, limit }, ctx);
      ctx.send({
        tool: {
          status: 'done',
          name: 'paper_search',
          query,
          provider: outcome.provider,
          results: (outcome.results || []).map((r) => ({
            title: String(r.title || ''),
            url: String(r.url || ''),
            snippet: String(r.snippet || r.tldr || ''),
          })),
          ...(outcome.error ? { error: outcome.error } : {}),
        },
      });
      if (outcome.error) {
        return {
          content: JSON.stringify({
            ok: false,
            error: outcome.error,
            query,
            provider: outcome.provider,
          }),
        };
      }
      return {
        content: formatHitsForModel('papers', query, outcome.provider, outcome.results),
      };
    },
  };
}

export function createBookSearchTool(): ChatTool {
  return {
    name: 'book_search',
    definition: {
      type: 'function',
      function: {
        name: 'book_search',
        description:
          'Search books/ebooks across LibGen, Internet Archive, Open Library, Gutenberg, and curated catalogs.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Book title, author, or topic.' },
            source: {
              type: 'string',
              description:
                'Optional: libgen | archive | openlibrary | gutenberg | fpb | aibooks | trading | github',
            },
            limit: { type: 'number', description: 'Max results (1–20, default 10).' },
          },
          required: ['query'],
        },
      },
    },
    systemPrompt: BOOK_SYSTEM,
    enabled: (flags) => flags.integrations.includes('book_search'),
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const { query, source, limit } = parseQuery(
        rawArguments,
        fallbackQuery || ctx.userAsk,
      );
      if (!query) {
        const error = 'book_search requires a query';
        ctx.send({ tool: { status: 'done', name: 'book_search', error } });
        return { content: JSON.stringify({ ok: false, error }) };
      }
      ctx.send({ tool: { status: 'start', name: 'book_search', query } });
      const outcome = await fetchLiterature('books', { query, source, limit }, ctx);
      ctx.send({
        tool: {
          status: 'done',
          name: 'book_search',
          query,
          provider: outcome.provider,
          results: (outcome.results || []).map((r) => ({
            title: String(r.title || ''),
            url: String(r.url || ''),
            snippet: String(r.snippet || r.tldr || ''),
          })),
          ...(outcome.error ? { error: outcome.error } : {}),
        },
      });
      if (outcome.error) {
        return {
          content: JSON.stringify({
            ok: false,
            error: outcome.error,
            query,
            provider: outcome.provider,
          }),
        };
      }
      return {
        content: formatHitsForModel('books', query, outcome.provider, outcome.results),
      };
    },
  };
}
