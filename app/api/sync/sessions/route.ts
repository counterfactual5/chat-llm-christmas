import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
const MAIN_SITE_BASE = 'https://llm.christmas/portal/chat/sessions';

/** Proxy session cloud-sync to the portal with the bound account key. */
async function proxyRequest(req: NextRequest, method: string) {
  const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!boundUserKey) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }

  try {
    const upstreamRes = await fetch(MAIN_SITE_BASE, {
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
