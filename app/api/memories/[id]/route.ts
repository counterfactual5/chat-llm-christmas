import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const MAIN_SITE_BASE = 'https://llm.christmas/portal/chat/memories';

type Params = { params: Promise<{ id: string }> };

async function proxyRequest(
  req: NextRequest,
  method: string,
  id: string,
) {
  const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!boundUserKey) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }

  try {
    const upstreamRes = await fetch(`${MAIN_SITE_BASE}/${encodeURIComponent(id)}`, {
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

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return proxyRequest(req, 'PUT', id);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return proxyRequest(req, 'DELETE', id);
}
