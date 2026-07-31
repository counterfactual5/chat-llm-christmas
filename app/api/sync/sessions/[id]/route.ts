import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
const MAIN_SITE_BASE = 'https://llm.christmas/portal/chat/sessions';

type Params = { params: Promise<{ id: string }> };

/** Delete one cloud session so a local delete does not resurrect on other devices. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!boundUserKey) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }

  const { id } = await params;
  const sessionId = String(id || '').trim();
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing session id' }, { status: 400 });
  }

  try {
    const upstreamRes = await fetch(
      `${MAIN_SITE_BASE}/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${boundUserKey}` },
        cache: 'no-store',
      },
    );
    const data = await upstreamRes.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstreamRes.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '请求失败' }, { status: 502 });
  }
}
