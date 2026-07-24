import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 20;

const COOKIE_NAME = 'llm_chat_api_key';

function baseURL() {
  return (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(/\/$/, '');
}

async function validateKey(apiKey: string) {
  const response = await fetch(`${baseURL()}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.slice(0, 200) || `API key validation failed (${response.status})`);
  }
}

export async function GET(req: NextRequest) {
  const bound = Boolean(req.cookies.get(COOKIE_NAME)?.value);
  return NextResponse.json({ bound });
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey } = await req.json();
    const normalized = String(apiKey || '').trim();

    if (!normalized.startsWith('sk-') || normalized.length < 20) {
      return NextResponse.json({ error: '请输入有效的 sk- API Key。' }, { status: 400 });
    }

    await validateKey(normalized);

    const response = NextResponse.json({ bound: true });
    response.cookies.set({
      name: COOKIE_NAME,
      value: normalized,
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '绑定 API Key 失败。' },
      { status: 401 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ bound: false });
  response.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
}
