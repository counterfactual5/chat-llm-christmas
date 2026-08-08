import { NextRequest } from 'next/server';
import { chatBackendToolsURL } from '@/lib/chat-backend';
import { normalizePreviewHttpUrl } from '@/lib/files/url-preview';

export const runtime = 'edge';
export const maxDuration = 60;

/** Client URL preview — proxies to chat-api shared web_read (SSRF gated there). */
export async function POST(req: NextRequest) {
  const key = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!key) {
    return Response.json({ error: '请先连接主站账号' }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const url = normalizePreviewHttpUrl(String(body?.url || ''));
    if (!url) {
      return Response.json({ error: 'Missing or invalid URL' }, { status: 400 });
    }
    const payload: Record<string, unknown> = { url };
    const maxChars = Number(body?.maxChars);
    if (Number.isFinite(maxChars) && maxChars > 0) {
      payload.maxChars = Math.min(Math.floor(maxChars), 200_000);
    }
    const startIndex = Number(body?.startIndex ?? body?.start_index);
    if (Number.isFinite(startIndex) && startIndex > 0) {
      payload.startIndex = Math.floor(startIndex);
    }
    const upstream = await fetch(chatBackendToolsURL('web_read'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    });
    const data = await upstream.json().catch(() => ({}));
    return Response.json(data, {
      status: upstream.ok ? 200 : upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
    });
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return Response.json({ error: 'Web read timed out' }, { status: 504 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : 'Web read failed' },
      { status: 500 },
    );
  }
}
