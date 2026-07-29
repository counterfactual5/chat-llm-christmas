/**
 * Multi-provider web page reader with fallback chain.
 * Order: Zhipu → Jina (if JINA_API_KEY) → bare fetch (last resort).
 */

export type WebReadOutcome = {
  provider: string;
  url: string;
  title?: string;
  description?: string;
  content: string;
  error?: string;
};

const MAX_CONTENT_CHARS = 48_000;

function zhipuApiKey(): string | undefined {
  return (
    process.env.ZHIPU_API_KEY?.trim() ||
    process.env.ZHIPUAI_API_KEY?.trim() ||
    process.env.BIGMODEL_API_KEY?.trim() ||
    undefined
  );
}

function jinaApiKey(): string | undefined {
  return process.env.JINA_API_KEY?.trim() || undefined;
}

function normalizeUrl(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    try {
      const u = new URL(`https://${s}`);
      return u.toString();
    } catch {
      return null;
    }
  }
}

function truncateContent(text: string): string {
  const t = String(text || '').trim();
  if (t.length <= MAX_CONTENT_CHARS) return t;
  return `${t.slice(0, MAX_CONTENT_CHARS)}\n\n…[truncated]`;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readZhipu(url: string): Promise<WebReadOutcome> {
  const key = zhipuApiKey();
  if (!key) throw new Error('ZHIPU_API_KEY missing');

  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/reader', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      timeout: 20,
      return_format: 'markdown',
      retain_images: false,
      with_links_summary: false,
    }),
    cache: 'no-store',
  });

  const data = (await res.json().catch(() => ({}))) as {
    reader_result?: {
      content?: string;
      description?: string;
      title?: string;
      url?: string;
    };
    error?: { code?: string; message?: string };
  };

  if (!res.ok) {
    throw new Error(
      data.error?.message || data.error?.code || `Zhipu reader HTTP ${res.status}`,
    );
  }

  const result = data.reader_result || {};
  const content = truncateContent(result.content || '');
  if (!content) throw new Error('Zhipu reader returned empty content');

  return {
    provider: 'zhipu',
    url: result.url || url,
    title: result.title || undefined,
    description: result.description || undefined,
    content,
  };
}

/**
 * Jina Reader: https://r.jina.ai/{url}
 * Requires JINA_API_KEY — anonymous access is unreliable / often blocked from
 * server IPs, and authenticated usage is token-billed after the signup grant.
 */
async function readJina(url: string): Promise<WebReadOutcome> {
  const key = jinaApiKey();
  if (!key) throw new Error('JINA_API_KEY missing');

  const endpoint = `https://r.jina.ai/${url}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Return-Format': 'markdown',
    Authorization: `Bearer ${key}`,
  };

  const res = await fetch(endpoint, { headers, cache: 'no-store' });
  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();

  if (!res.ok) {
    let message = `Jina reader HTTP ${res.status}`;
    try {
      const err = JSON.parse(raw) as { message?: string; readableMessage?: string };
      message = err.readableMessage || err.message || message;
    } catch {
      // keep default
    }
    throw new Error(message);
  }

  if (contentType.includes('application/json')) {
    const data = JSON.parse(raw) as {
      data?: { title?: string; description?: string; url?: string; content?: string };
      title?: string;
      description?: string;
      url?: string;
      content?: string;
    };
    const page = data.data || data;
    const content = truncateContent(page.content || '');
    if (!content) throw new Error('Jina reader returned empty content');
    return {
      provider: 'jina',
      url: page.url || url,
      title: page.title || undefined,
      description: page.description || undefined,
      content,
    };
  }

  const content = truncateContent(raw);
  if (!content) throw new Error('Jina reader returned empty content');
  return { provider: 'jina', url, content };
}

/** Last resort: plain HTTP GET + crude HTML strip (no JS rendering). */
async function readBareFetch(url: string): Promise<WebReadOutcome> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ChristmasChat-WebReader/1.0',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    },
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Fetch HTTP ${res.status}`);
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim();
  const content = truncateContent(stripHtmlToText(html));
  if (!content || content.length < 40) {
    throw new Error('Bare fetch extracted too little text');
  }
  return {
    provider: 'fetch',
    url,
    title: title || undefined,
    content,
  };
}

type ReaderProvider = {
  name: string;
  available: () => boolean;
  read: (url: string) => Promise<WebReadOutcome>;
};

const PROVIDERS: ReaderProvider[] = [
  {
    name: 'zhipu',
    available: () => Boolean(zhipuApiKey()),
    read: readZhipu,
  },
  {
    name: 'jina',
    available: () => Boolean(jinaApiKey()),
    read: readJina,
  },
  {
    name: 'fetch',
    available: () => true,
    read: readBareFetch,
  },
];

/** Run the fallback chain until one provider returns page content. */
export async function webRead(urlInput: string): Promise<WebReadOutcome> {
  const url = normalizeUrl(urlInput);
  if (!url) {
    return { provider: 'none', url: '', content: '', error: 'Invalid or missing URL' };
  }

  const errors: string[] = [];
  for (const provider of PROVIDERS) {
    if (!provider.available()) continue;
    try {
      return await provider.read(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err || 'failed');
      errors.push(`${provider.name}: ${message}`);
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
      'Fetch and extract the main text of a specific public webpage URL (after web_search or when the user gives a link). Returns title + cleaned markdown/text body. Use when snippets from search are not enough.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute http(s) URL to read.',
        },
      },
      required: ['url'],
    },
  },
};
