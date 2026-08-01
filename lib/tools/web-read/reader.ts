/**
 * Multi-provider web page reader with fallback chain.
 * Order: Zhipu Coding Plan MCP → Tavily Extract → Jina → bare fetch.
 *
 *  types.ts     shared outcome + limits
 *  url.ts       normalize + block blocklist
 *  extract.ts   HTML / JSON main-text extraction
 *  fetchers.ts  provider implementations
 *  zhipu.ts     Zhipu MCP client
 */

import { PROVIDERS } from '@/lib/tools/web-read/fetchers';
import type { WebReadOutcome } from '@/lib/tools/web-read/types';
import { normalizeUrl } from '@/lib/tools/web-read/url';

export type { WebReadOutcome } from '@/lib/tools/web-read/types';

/** Run the fallback chain until one provider returns page content. */
export async function webRead(urlInput: string): Promise<WebReadOutcome> {
  const url = normalizeUrl(urlInput);
  if (!url) {
    return {
      provider: 'none',
      url: '',
      content: '',
      error: 'Invalid, missing, or blocked URL',
    };
  }

  const errors: string[] = [];
  for (const provider of PROVIDERS) {
    if (!provider.available()) continue;
    try {
      return await provider.read(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err || 'failed');
      errors.push(`${provider.name}: ${message}`);
      console.warn(`[web_read] ${provider.name} failed, trying next:`, message);
    }
  }

  return {
    provider: 'none',
    url,
    content: '',
    error: errors.join(' | ') || 'All readers failed',
  };
}

export function formatWebReadForModel(outcome: WebReadOutcome): string {
  if (!outcome.content) {
    return JSON.stringify({
      ok: false,
      url: outcome.url,
      provider: outcome.provider,
      error: outcome.error || 'Failed to read page',
      guidance: 'Tell the user the page could not be fetched. Do not invent page contents.',
    });
  }

  return JSON.stringify({
    ok: true,
    provider: outcome.provider,
    url: outcome.url,
    title: outcome.title || null,
    description: outcome.description || null,
    content: outcome.content,
    guidance:
      'This IS the full-page extract. Cite the URL when answering. Do not claim you could not read the page if content is present.',
  });
}

export const WEB_READ_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_read',
    description:
      'Fetch and extract the main text of a specific public webpage URL (after web_search or when the user gives a link). Returns title + cleaned markdown/text body. Use when snippets from search are not enough. Required: absolute http(s) `url` copied from a search result — never pass a search query string.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'Absolute http(s) URL to read, e.g. https://www.example.com/article. Must start with http:// or https://.',
        },
      },
      required: ['url'],
    },
  },
};
