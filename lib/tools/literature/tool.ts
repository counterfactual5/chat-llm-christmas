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
  resolvePaperActionId,
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
    'Each hit is one numbered list item: title link, then meta (authors · year · source · size), ' +
    'then each Download / Manual download command as a nested unordered-list bullet in backticks. ' +
    'Blank line only before the next `N.`. ' +
    'Only use downloadCommand / alternateDownloads from this receipt — never invent md5 or archive ids, ' +
    'never bury commands in em-dash prose or narrative sentences. ' +
    'If downloadCommand is missing, use Manual download: [title](url) on its own line under the meta.',
  papers:
    'Prefer copying answerMarkdown verbatim for the results list (same shape as /papers). ' +
    'Each hit is one numbered list item: title link, then meta (authors · year · venue · ID), ' +
    'then each `/papers details|citations|references|download` command as a nested unordered-list bullet in backticks ' +
    '(markdown hard breaks between title/meta only; no blank lines between bullets). ' +
    'Blank line only before the next `N.`. ' +
    'When downloadCommand is present, emit that command as its own nested bullet in backticks — that stores the PDF in Files; ' +
    'do not turn an external URL into a “download” link. ' +
    'Never invent ids or bury commands in em-dash prose. ' +
    'When only pdfUrl is present (no downloadCommand), link it as Open PDF on its own line.',
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
      const actionId = resolvePaperActionId(r) || undefined;
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
        paperId: actionId || (r.paperId ? String(r.paperId) : undefined),
        // Only expose pdfUrl when API download is unavailable — otherwise models
        // turn it into a “下载” markdown link and skip /papers download → Files.
        ...(downloadCommand
          ? { downloadCommand }
          : r.pdfUrl
            ? { pdfUrl: r.pdfUrl }
            : {}),
        detailsCommand: actionId
          ? formatPaperActionCommand('details', actionId)
          : undefined,
        citationsCommand: actionId
          ? formatPaperActionCommand('citations', actionId)
          : undefined,
        referencesCommand: actionId
          ? formatPaperActionCommand('references', actionId)
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
  'After results, match answerMarkdown / the /papers slash shape: one numbered list item per hit — title link, meta line, then each `/papers details|citations|references|download` command as a nested unordered-list bullet in backticks (hard breaks between title/meta only; no blank lines between bullets) — never invent ids, never bury commands in em-dash prose.',
  'Blank line before the next numbered hit.',
  'Copy exact receipt fields (detailsCommand / citationsCommand / referencesCommand / downloadCommand) as inline code so they become clickable buttons.',
  'downloadCommand saves the PDF into the user Files store (in-app). Emit it as its own nested bullet in backticks — do not turn an external URL into a “download” link.',
  'Only when a hit has pdfUrl and no downloadCommand, link pdfUrl as Open PDF on its own line.',
].join(' ');

export const BOOK_SYSTEM = [
  'You have a book_search tool for books (LibGen / Internet Archive / Open Library / Gutenberg / catalogs).',
  'Call it when the user asks to find books or ebooks. Prefer book_search over web_search for book lookup.',
  'After results, match answerMarkdown / the /books slash shape: one numbered list item per hit — title link, meta line, then each `/books download …` / Manual download as a nested unordered-list bullet in backticks — never invent identifiers, never bury commands in em-dash prose.',
  'Blank line before the next numbered hit.',
  'When downloadCommand is absent, put Manual download: [title](url) as a nested bullet under the meta. Prefer copying answerMarkdown from the receipt when present.',
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
