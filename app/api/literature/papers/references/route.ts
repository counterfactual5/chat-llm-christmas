import { NextRequest, NextResponse } from 'next/server';
import { chatBackendLiteratureURL } from '@/lib/chat-backend';

export const runtime = 'edge';
export const maxDuration = 60;

/** POST /api/literature/papers/references */
export async function POST(req: NextRequest) {
  const key = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!key) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const upstream = await fetch(chatBackendLiteratureURL('papers/references'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
