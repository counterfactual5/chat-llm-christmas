import { NextRequest, NextResponse } from 'next/server';
import { chatBackendResearchURL } from '@/lib/chat-backend';

export const runtime = 'edge';

function authHeaders(req: NextRequest): HeadersInit | null {
  const key = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!key) return null;
  return {
    Authorization: `Bearer ${key}`,
  };
}

/** GET /api/research/:id */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const headers = authHeaders(req);
  if (!headers) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const upstream = await fetch(chatBackendResearchURL(id), {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
