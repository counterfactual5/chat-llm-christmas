/**
 * Multi-provider web page reader — thin client to chat-api `/v1/tools/web_read`.
 * Engines (Zhipu → Tavily → Jina → Fetch MCP → keyless → bare) live on the product backend.
 */

import { chatBackendToolsURL } from '@/lib/chat-backend';
import type { WebReadOutcome } from '@/lib/tools/web-read/types';

export type { WebReadOutcome } from '@/lib/tools/web-read/types';

export type WebReadClientOptions = {
  apiKey?: string;
  maxChars?: number;
  signal?: AbortSignal;
};

/** Run the backend fallback chain until one provider returns page content. */
export async function webRead(
  urlInput: string,
  options: WebReadClientOptions = {},
): Promise<WebReadOutcome> {
  const url = String(urlInput || '').trim();
  if (!url) {
    return {
      provider: 'none',
      url: '',
      content: '',
      error: 'Invalid, missing, or blocked URL',
    };
  }

  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    return {
      provider: 'none',
      url,
      content: '',
      error: 'Web read requires a connected account',
    };
  }

  try {
    const body: Record<string, unknown> = { url };
    if (options.maxChars) body.maxChars = options.maxChars;
    const res = await fetch(chatBackendToolsURL('web_read'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: options.signal ?? AbortSignal.timeout(45_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      provider?: string;
      url?: string;
      title?: string | null;
      description?: string | null;
      content?: string;
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      return {
        provider: 'none',
        url,
        content: '',
        error: data.error || data.message || `HTTP ${res.status}`,
      };
    }
    return {
      provider: String(data.provider || 'none'),
      url: String(data.url || url),
      title: data.title || undefined,
      description: data.description || undefined,
      content: String(data.content || ''),
      error: data.error || undefined,
    };
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : '';
    const message =
      name === 'TimeoutError' || name === 'AbortError'
        ? 'Read timed out'
        : err instanceof Error
          ? err.message
          : String(err);
    return { provider: 'none', url, content: '', error: message };
  }
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
