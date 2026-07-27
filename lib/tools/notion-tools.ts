import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import {
  notionAppendParagraphs,
  notionFetchPageContent,
  notionSearch,
} from '@/lib/notion/client';

function notionToken(ctx: ToolRuntimeContext): string | null {
  const token = ctx.credentials?.notionAccessToken?.trim();
  return token || null;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const NOTION_SYSTEM_PROMPT = [
  "You have Notion tools for the user's connected workspace (only pages/databases shared with the integration).",
  'Use notion_search to find pages, notion_fetch_page to read content, and notion_append_blocks to add text to a page.',
  'Do not invent Notion page IDs, titles, or content — only use tool results.',
  'Ask before making large edits when the user intent is ambiguous.',
  'If search returns nothing, say the page may not be shared with the integration.',
  'Cite page titles and URLs from tool results when answering.',
].join(' ');

export function createNotionSearchTool(): ChatTool {
  return {
    name: 'notion_search',
    definition: {
      type: 'function',
      function: {
        name: 'notion_search',
        description:
          "Search the user's Notion workspace for pages or databases by keyword. Only returns items shared with the connected integration.",
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search keywords (page or database title / content).',
            },
            filter: {
              type: 'string',
              enum: ['page', 'database'],
              description: 'Optional: limit results to pages or databases.',
            },
          },
          required: ['query'],
        },
      },
    },
    systemPrompt: NOTION_SYSTEM_PROMPT,
    enabled: (flags) => flags.integrations.includes('notion'),
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const token = notionToken(ctx);
      if (!token) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'Notion is not connected for this account.',
          }),
        };
      }

      const args = parseArgs(rawArguments);
      const query = String(args.query || fallbackQuery || ctx.userAsk || '')
        .trim()
        .slice(0, 200);
      const filter =
        args.filter === 'page' || args.filter === 'database' ? args.filter : undefined;

      ctx.send({
        tool: { status: 'start', name: 'notion_search', query, provider: 'notion' },
      });

      if (!query) {
        const error = 'Missing search query';
        ctx.send({
          tool: {
            status: 'done',
            name: 'notion_search',
            query,
            provider: 'notion',
            results: [],
            error,
          },
        });
        return { content: JSON.stringify({ ok: false, error, results: [] }) };
      }

      const outcome = await notionSearch(token, query, { filter, pageSize: 10 });
      const results = outcome.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: `${r.object}${r.lastEditedTime ? ` · edited ${r.lastEditedTime}` : ''} · id ${r.id}`,
      }));

      ctx.send({
        tool: {
          status: 'done',
          name: 'notion_search',
          query,
          provider: 'notion',
          results,
          error: outcome.error,
        },
      });

      return {
        content: JSON.stringify({
          ok: outcome.ok,
          query,
          count: outcome.results.length,
          results: outcome.results,
          error: outcome.error,
          hint: outcome.results.length
            ? 'Call notion_fetch_page with a result id to read, or notion_append_blocks to write.'
            : 'No shared pages matched. Ask the user to share the page with the integration.',
        }),
      };
    },
  };
}

export function createNotionFetchPageTool(): ChatTool {
  return {
    name: 'notion_fetch_page',
    definition: {
      type: 'function',
      function: {
        name: 'notion_fetch_page',
        description:
          'Read the title and text content of a Notion page by ID (from notion_search results).',
        parameters: {
          type: 'object',
          properties: {
            page_id: {
              type: 'string',
              description: 'Notion page ID (UUID from notion_search).',
            },
          },
          required: ['page_id'],
        },
      },
    },
    enabled: (flags) => flags.integrations.includes('notion'),
    async execute({ rawArguments }, ctx) {
      const token = notionToken(ctx);
      if (!token) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'Notion is not connected for this account.',
          }),
        };
      }

      const args = parseArgs(rawArguments);
      const pageId = String(args.page_id || args.pageId || args.id || '').trim();
      ctx.send({
        tool: {
          status: 'start',
          name: 'notion_fetch_page',
          query: pageId || 'page',
          provider: 'notion',
        },
      });

      if (!pageId) {
        const error = 'Missing page_id';
        ctx.send({
          tool: {
            status: 'done',
            name: 'notion_fetch_page',
            query: pageId,
            provider: 'notion',
            results: [],
            error,
          },
        });
        return { content: JSON.stringify({ ok: false, error }) };
      }

      const page = await notionFetchPageContent(token, pageId);
      const results = page.ok
        ? [
            {
              title: page.title,
              url: page.url,
              snippet: page.text.slice(0, 240),
            },
          ]
        : [];

      ctx.send({
        tool: {
          status: 'done',
          name: 'notion_fetch_page',
          query: pageId,
          provider: 'notion',
          results,
          error: page.error,
        },
      });

      return {
        content: JSON.stringify({
          ok: page.ok,
          id: page.id,
          title: page.title,
          url: page.url,
          text: page.text,
          error: page.error,
        }),
      };
    },
  };
}

export function createNotionAppendBlocksTool(): ChatTool {
  return {
    name: 'notion_append_blocks',
    definition: {
      type: 'function',
      function: {
        name: 'notion_append_blocks',
        description:
          'Append one or more paragraph blocks to the end of a Notion page (write/edit). Use a page_id from notion_search.',
        parameters: {
          type: 'object',
          properties: {
            page_id: {
              type: 'string',
              description: 'Notion page ID to append content to.',
            },
            paragraphs: {
              type: 'array',
              items: { type: 'string' },
              description: 'Paragraphs to append, in order (max 20).',
            },
            text: {
              type: 'string',
              description: 'Optional single paragraph if paragraphs array is omitted.',
            },
          },
          required: ['page_id'],
        },
      },
    },
    enabled: (flags) => flags.integrations.includes('notion'),
    async execute({ rawArguments }, ctx) {
      const token = notionToken(ctx);
      if (!token) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'Notion is not connected for this account.',
          }),
        };
      }

      const args = parseArgs(rawArguments);
      const pageId = String(args.page_id || args.pageId || args.id || '').trim();
      const fromArray = Array.isArray(args.paragraphs)
        ? args.paragraphs.map((p) => String(p ?? ''))
        : [];
      const single = String(args.text || args.content || '').trim();
      const paragraphs = fromArray.length > 0 ? fromArray : single ? [single] : [];

      ctx.send({
        tool: {
          status: 'start',
          name: 'notion_append_blocks',
          query: pageId || 'page',
          provider: 'notion',
        },
      });

      if (!pageId) {
        const error = 'Missing page_id';
        ctx.send({
          tool: {
            status: 'done',
            name: 'notion_append_blocks',
            query: pageId,
            provider: 'notion',
            results: [],
            error,
          },
        });
        return { content: JSON.stringify({ ok: false, error }) };
      }

      const outcome = await notionAppendParagraphs(token, pageId, paragraphs);
      const results = outcome.ok
        ? [
            {
              title: `Appended ${outcome.appended} paragraph(s)`,
              url: outcome.url || '',
              snippet: paragraphs.slice(0, 2).join(' · ').slice(0, 240),
            },
          ]
        : [];

      ctx.send({
        tool: {
          status: 'done',
          name: 'notion_append_blocks',
          query: pageId,
          provider: 'notion',
          results,
          error: outcome.error,
        },
      });

      return {
        content: JSON.stringify({
          ok: outcome.ok,
          id: outcome.id,
          url: outcome.url,
          appended: outcome.appended,
          error: outcome.error,
        }),
      };
    },
  };
}

export function createNotionTools(): ChatTool[] {
  return [
    createNotionSearchTool(),
    createNotionFetchPageTool(),
    createNotionAppendBlocksTool(),
  ];
}
