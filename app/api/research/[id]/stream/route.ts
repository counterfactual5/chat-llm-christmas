import { NextRequest, NextResponse } from 'next/server';
import { chatBackendResearchURL } from '@/lib/chat-backend';

export const runtime = 'edge';
export const maxDuration = 300;

/** GET /api/research/:id/stream — proxy SSE from chat-api */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const key = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!key) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const last = req.nextUrl.searchParams.get('last_event_id') || '0';
  const url = `${chatBackendResearchURL(id)}/stream?last_event_id=${encodeURIComponent(last)}`;

  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'text/event-stream',
      },
      cache: 'no-store',
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      return NextResponse.json(
        { error: text.slice(0, 300) || `upstream ${upstream.status}` },
        { status: upstream.status || 502 },
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
