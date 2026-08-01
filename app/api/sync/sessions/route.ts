import { NextRequest, NextResponse } from 'next/server';
import { chatBackendSessionsURL } from '@/lib/chat-backend';

export const runtime = 'edge';

/** Proxy session cloud-sync to chat-api with the bound account key. */
async function proxyRequest(req: NextRequest, method: string) {
  const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!boundUserKey) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }

  try {
    const upstreamRes = await fetch(chatBackendSessionsURL(), {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${boundUserKey}`,
      },
      body: method === 'PUT' ? await req.text() : undefined,
      cache: 'no-store',
    });

    const data = await upstreamRes.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstreamRes.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '请求失败' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  return proxyRequest(req, 'GET');
}

export async function PUT(req: NextRequest) {
  return proxyRequest(req, 'PUT');
}
