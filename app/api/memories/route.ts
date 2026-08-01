import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const MAIN_SITE_BASE = 'https://llm.christmas/portal/chat/memories';

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
  return proxyRequest(req, 'GET', `${MAIN_SITE_BASE}?limit=${encodeURIComponent(limit)}`);
}

/** Create/update a batch of memories on the portal. */
export async function POST(req: NextRequest) {
  return proxyRequest(req, 'POST', `${MAIN_SITE_BASE}/batch`);
}
