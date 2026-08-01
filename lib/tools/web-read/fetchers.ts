/**
 * Web-read provider implementations (Zhipu / Tavily / Jina / bare fetch).
 */

import { zhipuMcpEnabled } from '@/lib/tools/zhipu/credentials';
import { zhipuMcpWebRead } from '@/lib/tools/web-read/zhipu';
import { extractFromHtml } from '@/lib/tools/web-read/extract';
import { isBlockedHostname } from '@/lib/tools/web-read/url';
import {
  BARE_FETCH_TIMEOUT_MS,
  BROWSER_UA,
  MAX_FETCH_BYTES,
  MIN_EXTRACT_CHARS,
  PROVIDER_FETCH_TIMEOUT_MS,
  truncateContent,
  type WebReadOutcome,
} from '@/lib/tools/web-read/types';

function tavilyApiKey(): string | undefined {
  return process.env.TAVILY_API_KEY?.trim() || undefined;
}

/** Keyless Extract is free but rate-limited; disable with TAVILY_EXTRACT_KEYLESS=0. */
function tavilyKeylessEnabled(): boolean {
  const flag = (process.env.TAVILY_EXTRACT_KEYLESS || '1').trim().toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
}

function tavilyExtractAvailable(): boolean {
  return Boolean(tavilyApiKey()) || tavilyKeylessEnabled();
}

function jinaApiKey(): string | undefined {
  return process.env.JINA_API_KEY?.trim() || undefined;
}

function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = String((err as { name?: string }).name || '');
  return name === 'TimeoutError' || name === 'AbortError';
}

async function readResponseTextLimited(
  res: Response,
  maxBytes = MAX_FETCH_BYTES,
): Promise<string> {
  const declared = Number(res.headers.get('content-length') || '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response too large (${declared} bytes)`);
  }
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error(`Response too large (>${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

async function readZhipu(url: string): Promise<WebReadOutcome> {
  if (!zhipuMcpEnabled()) throw new Error('Zhipu MCP disabled');
  // Coding Plan MCP only — PaaS `/reader` bills balance and is unused here.
  // docs: https://docs.bigmodel.cn/cn/coding-plan/mcp/reader-mcp-server
  const mcp = await zhipuMcpWebRead(url);
  const content = truncateContent(mcp.content || '');
  if (!content) throw new Error('Zhipu MCP webReader returned empty content');
  return {
    provider: 'zhipu-mcp',
    url: mcp.url || url,
    title: mcp.title,
    description: mcp.description,
    content,
  };
}

/**
 * Tavily Extract — same free monthly credits as search (1k/mo with key),
 * or keyless rate-limited access. docs:
 * https://docs.tavily.com/documentation/api-reference/endpoint/extract
 */
async function readTavily(url: string): Promise<WebReadOutcome> {
  const key = tavilyApiKey();
  if (!key && !tavilyKeylessEnabled()) {
    throw new Error('Tavily extract unavailable');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  } else {
    headers['X-Tavily-Access-Mode'] = 'keyless';
  }

  let res: Response;
  try {
    res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        urls: [url],
        format: 'markdown',
        extract_depth: 'basic',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      throw new Error(`Tavily extract timed out after ${PROVIDER_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  const raw = await readResponseTextLimited(res, 1_500_000);
  if (!res.ok) {
    let message = `Tavily extract HTTP ${res.status}`;
    try {
      const err = JSON.parse(raw) as {
        detail?: { error?: string } | string;
        error?: string;
        message?: string;
      };
      const detail =
        typeof err.detail === 'string'
          ? err.detail
          : err.detail && typeof err.detail === 'object'
            ? err.detail.error
            : undefined;
      message = detail || err.error || err.message || message;
    } catch {
      // keep default
    }
    throw new Error(message);
  }

  const data = JSON.parse(raw) as {
    results?: Array<{ url?: string; title?: string; raw_content?: string }>;
    failed_results?: Array<{ url?: string; error?: string }>;
  };
  const hit = (data.results || []).find((r) => String(r.raw_content || '').trim());
  if (!hit) {
    const fail = data.failed_results?.[0]?.error || 'no content';
    throw new Error(`Tavily extract failed: ${fail}`);
  }
  const content = truncateContent(hit.raw_content || '');
  if (!content) throw new Error('Tavily extract returned empty content');
  return {
    provider: key ? 'tavily' : 'tavily-keyless',
    url: hit.url || url,
    title: hit.title || undefined,
    content,
  };
}

/**
 * Jina Reader: https://r.jina.ai/{url}
 * Requires JINA_API_KEY — free signup tokens run out; kept as optional fallback.
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

  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      throw new Error(`Jina reader timed out after ${PROVIDER_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  const raw = await readResponseTextLimited(res, 1_500_000);

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

/** Last resort: plain HTTP GET + structured HTML extract (no JS rendering). */
async function readBareFetch(url: string): Promise<WebReadOutcome> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      },
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(BARE_FETCH_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      throw new Error(`Fetch timed out after ${BARE_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  if (!res.ok) throw new Error(`Fetch HTTP ${res.status}`);
  // After redirects, refuse private/metadata hosts (DNS rebinding / open redirect).
  const finalHost = (() => {
    try {
      return new URL(res.url || url).hostname;
    } catch {
      return '';
    }
  })();
  if (finalHost && isBlockedHostname(finalHost)) {
    throw new Error('Blocked private or local URL after redirect');
  }
  const html = await readResponseTextLimited(res);
  const extracted = extractFromHtml(html);
  if (!extracted.content || extracted.content.length < MIN_EXTRACT_CHARS) {
    throw new Error('Bare fetch extracted too little text');
  }
  return {
    provider: 'fetch',
    url: res.url || url,
    title: extracted.title,
    description: extracted.description,
    content: extracted.content,
  };
}

type ReaderProvider = {
  name: string;
  available: () => boolean;
  read: (url: string) => Promise<WebReadOutcome>;
};

export const PROVIDERS: ReaderProvider[] = [
  {
    name: 'zhipu',
    available: () => zhipuMcpEnabled(),
    read: readZhipu,
  },
  {
    name: 'tavily',
    available: () => tavilyExtractAvailable(),
    read: readTavily,
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
