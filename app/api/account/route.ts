import { NextRequest, NextResponse } from 'next/server';
import { clearVaultCookie, remoteVaultConfigured } from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 20;

const COOKIE_NAME = 'llm_chat_api_key';
const USERNAME_COOKIE = 'llm_chat_username';

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

function clearUsernameCookie(response: NextResponse) {
  response.cookies.set({
    name: USERNAME_COOKIE,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * When remote KV is configured, drop browser vault cookies on account switch /
 * sign-out so another key never sees leftover blobs. The durable copy stays in
 * KV and is re-hydrated after the same account signs back in.
 * Without KV, keep cookies so same-browser reconnects still work.
 */
function clearBrowserVaultIfRemote(response: NextResponse) {
  if (remoteVaultConfigured()) clearVaultCookie(response);
}

/**
 * Bound status only — no username probing against the main site.
 * Optional display name comes from an existing cookie if SSO already set one.
 */
export async function GET(req: NextRequest) {
  const apiKey = req.cookies.get(COOKIE_NAME)?.value?.trim() || '';
  const bound = apiKey.startsWith('sk-') && apiKey.length >= 20;
  if (!bound) {
    return NextResponse.json({ bound: false, username: null });
  }
  const username = req.cookies.get(USERNAME_COOKIE)?.value?.trim() || null;
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

    const response = NextResponse.json({ bound: true, username: null });
    clearBrowserVaultIfRemote(response);
    clearUsernameCookie(response);
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
  clearBrowserVaultIfRemote(response);
  clearUsernameCookie(response);
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
