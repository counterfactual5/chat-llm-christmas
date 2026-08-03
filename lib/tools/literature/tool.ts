/**
 * Model-callable literature tools: paper_search + book_search.
 * Backed by chat-api `/v1/literature/*` (same stack as `/papers` `/books` commands).
 */

import { chatBackendLiteratureURL } from '@/lib/chat-backend';
import type { LiteratureHit } from '@/lib/chat/turn/literature-search';
import {
  formatBookDownloadCommand,
  formatPaperActionCommand,
  isValidBookDownloadIdentifier,
  resolveBookDownloadIdentifier,
} from '@/lib/chat/turn/literature-command';
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

/** Shape tool receipts so the model can cite real download / paper-action commands. */
export function formatHitsForModel(
  kind: 'papers' | 'books',
  query: string,
  provider: string,
  results: LiteratureHit[],
): string {
  if (!results.length) {
    return JSON.stringify({
      ok: true,
      kind,
      query,
      provider,
      results: [],
      note: 'No results. Try a different query or source.',
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
        };
      }),
      hint:
        'Only show /books download commands that appear as downloadCommand on a hit. ' +
        'If downloadCommand is missing, give the page url as a markdown Manual download link — never invent md5 or archive ids.',
    });
  }

  return JSON.stringify({
    ok: true,
    kind,
    query,
    provider,
    results: results.slice(0, 12).map((r) => {
      const paperId = r.paperId ? String(r.paperId) : undefined;
      return {
        title: r.title || '',
        url: r.url || '',
        snippet: r.snippet || r.tldr || '',
        authors: r.authors,
        year: r.year,
        source: r.sourceProvider,
        paperId,
        pdfUrl: r.pdfUrl,
        detailsCommand: paperId ? formatPaperActionCommand('details', paperId) : undefined,
        citationsCommand: paperId
          ? formatPaperActionCommand('citations', paperId)
          : undefined,
        referencesCommand: paperId
          ? formatPaperActionCommand('references', paperId)
          : undefined,
      };
    }),
    hint:
      'Only show /papers details|citations|references commands from the receipt fields. ' +
      'Never invent paper ids. Prefer pdfUrl as a markdown link when present.',
  });
}

const PAPER_SYSTEM = [
  'You have a paper_search tool for academic papers (arXiv / Semantic Scholar / OpenAlex).',
  'Call it when the user asks for papers, research literature, citations, or scholarly work — do not invent paper titles/DOIs.',
  'Prefer paper_search over web_search for academic literature.',
  'If this tool is OFF, the user can still run the always-available slash command /papers — never say /papers is unavailable.',
  'After results, cite title + URL; only offer /papers details|citations|references using paperId/commands from the tool receipt — never invent ids.',
  'When pdfUrl is present, show it as a markdown link.',
].join(' ');

const BOOK_SYSTEM = [
  'You have a book_search tool for books (LibGen / Internet Archive / Open Library / Gutenberg / catalogs).',
  'Call it when the user asks to find books or ebooks. Prefer book_search over web_search for book lookup.',
  'If this tool is OFF, the user can still run the always-available slash command /books — never say /books is unavailable.',
  'For downloads: only cite downloadCommand from the tool receipt (libgen md5 / IA id / gutenberg:id / direct URL). Never invent identifiers or claim only LibGen works.',
  'When downloadCommand is absent, give the hit url as a markdown Manual download link for the user to open themselves.',
  'After results, cite title + URL; never invent catalog entries.',
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
