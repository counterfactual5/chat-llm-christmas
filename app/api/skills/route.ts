import { NextRequest, NextResponse } from 'next/server';
import { chatBackendSkillsURL } from '@/lib/chat-backend';

export const runtime = 'edge';

async function proxyRequest(req: NextRequest, method: string) {
  const boundUserKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!boundUserKey) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.pathname.split('/').pop();
  const base = chatBackendSkillsURL();
  const targetUrl = id && id !== 'skills' ? `${base}/${id}` : base;

  try {
    const upstreamRes = await fetch(targetUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${boundUserKey}`,
      },
      body: method === 'POST' || method === 'PUT' ? await req.text() : undefined,
      cache: 'no-store',
    });

    const data = await upstreamRes.json();
    return NextResponse.json(data, { status: upstreamRes.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '请求失败' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  return proxyRequest(req, 'GET');
}
export async function POST(req: NextRequest) {
  return proxyRequest(req, 'POST');
}
export async function PUT(req: NextRequest) {
  return proxyRequest(req, 'PUT');
}
export async function DELETE(req: NextRequest) {
  return proxyRequest(req, 'DELETE');
}
