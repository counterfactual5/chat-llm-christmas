import { NextRequest, NextResponse } from 'next/server';
import { clearVaultCookie } from '@/lib/integrations';

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

async function fetchAccountUsername(apiKey: string): Promise<string | null> {
  try {
    const response = await fetch('https://llm.christmas/api/user/self', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const user = payload?.data ?? payload?.user ?? payload;
    if (!user || typeof user !== 'object') return null;
    const name =
      user.username || user.display_name || user.email || (user.id != null ? `User #${user.id}` : '');
    return name ? String(name) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const apiKey = req.cookies.get(COOKIE_NAME)?.value?.trim() || '';
  const bound = apiKey.startsWith('sk-') && apiKey.length >= 20;
  if (!bound) {
    return NextResponse.json({ bound: false, username: null });
  }
  const username = await fetchAccountUsername(apiKey);
  return NextResponse.json({ bound: true, username });
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
    // Switching accounts must drop the previous owner's Notion/GitHub tokens.
    clearVaultCookie(response);
    response.cookies.set({
      name: COOKIE_NAME,
      value: normalized,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
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
  clearVaultCookie(response);
  response.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
