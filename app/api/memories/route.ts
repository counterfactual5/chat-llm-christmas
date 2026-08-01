import { NextRequest, NextResponse } from 'next/server';
import { chatBackendMemoriesURL } from '@/lib/chat-backend';

export const runtime = 'edge';

async function proxyRequest(req: NextRequest, method: string, targetUrl: string) {
  const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!boundUserKey) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${boundUserKey}`,
      },
      body: method === 'GET' || method === 'DELETE' ? undefined : await req.text(),
      cache: 'no-store',
    });
    const data = await upstreamRes.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstreamRes.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '请求失败' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const limit = new URL(req.url).searchParams.get('limit') || '50';
  return proxyRequest(
    req,
    'GET',
    `${chatBackendMemoriesURL()}?limit=${encodeURIComponent(limit)}`,
  );
}

/** Create/update a batch of memories on chat-api. */
export async function POST(req: NextRequest) {
  return proxyRequest(req, 'POST', `${chatBackendMemoriesURL()}/batch`);
}
