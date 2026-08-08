import { NextRequest, NextResponse } from 'next/server';
import { chatBackendLiteratureURL } from '@/lib/chat-backend';

export const runtime = 'edge';
export const maxDuration = 60;

/**
 * GET /api/literature/papers/resolve?identifier=…
 * Resolve OA PDF metadata without downloading or storing.
 */
export async function GET(req: NextRequest) {
  const key = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!key) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }
  const identifier = String(req.nextUrl.searchParams.get('identifier') || '').trim();
  if (!identifier) {
    return NextResponse.json({ error: 'Missing identifier' }, { status: 400 });
  }
  try {
    const upstreamUrl = new URL(chatBackendLiteratureURL('papers/resolve'));
    upstreamUrl.searchParams.set('identifier', identifier);
    const upstream = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
