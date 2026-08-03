import { NextRequest } from 'next/server';
import { chatBackendToolsURL } from '@/lib/chat-backend';

export const runtime = 'edge';
export const maxDuration = 60;

/** Debug / direct search — proxies to chat-api shared engine. */
export async function POST(req: NextRequest) {
  const key = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!key) {
    return Response.json({ error: '请先连接主站账号' }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body?.query || body?.q || '').trim();
    if (!query) {
      return Response.json({ error: 'Missing query' }, { status: 400 });
    }
    const sourcesRaw = String(body?.sources || body?.source || 'web')
      .trim()
      .toLowerCase();
    const sources =
      sourcesRaw === 'news' || sourcesRaw === 'wiki' || sourcesRaw === 'wikipedia'
        ? sourcesRaw === 'wikipedia'
          ? 'wiki'
          : sourcesRaw
        : 'web';
    const toolPath =
      sources === 'news' ? 'news_search' : sources === 'wiki' ? 'wiki_search' : 'web_search';
    const payload: Record<string, unknown> = {
      query,
      freshness: body?.freshness ?? null,
    };
    if (toolPath === 'web_search') payload.sources = 'web';
    if (toolPath === 'wiki_search' && body?.lang) payload.lang = body.lang;
    const upstream = await fetch(chatBackendToolsURL(toolPath), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(35_000),
    });
    const data = await upstream.json().catch(() => ({}));
    const hasResults = Array.isArray((data as { results?: unknown[] }).results)
      ? (data as { results: unknown[] }).results.length > 0
      : false;
    return Response.json(data, {
      status: upstream.ok ? (hasResults ? 200 : 502) : upstream.status,
    });
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return Response.json({ error: 'Search timed out' }, { status: 504 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : 'Search failed' },
      { status: 500 },
    );
  }
}
