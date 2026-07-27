import { NextRequest, NextResponse } from 'next/server';
import { clearVaultCookie } from '@/lib/integrations';
import { usernameFromTokenPayload, fetchUsernameForApiKey } from '@/lib/account-profile';

export const runtime = 'edge';
export const maxDuration = 30;

const STATE_COOKIE = 'llm_chat_oauth_state';
const KEY_COOKIE = 'llm_chat_api_key';
const USERNAME_COOKIE = 'llm_chat_username';
const CALLBACK = 'https://chat.llm.christmas/api/auth/callback';

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function redirectWithError(req: NextRequest, message: string) {
  const url = new URL('/', req.url);
  url.searchParams.set('auth_error', message.slice(0, 180));
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || '';
  const state = req.nextUrl.searchParams.get('state') || '';
  const expectedState = req.cookies.get(STATE_COOKIE)?.value || '';

  if (!code || !safeEqual(state, expectedState)) {
    return redirectWithError(req, '授权状态无效，请重新连接主站账号。');
  }

  const secret = process.env.CHAT_SSO_SECRET || '';
  if (!secret) {
    return redirectWithError(req, 'Chat SSO 尚未配置。');
  }

  try {
    const response = await fetch('https://llm.christmas/portal/chat/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Chat-SSO-Secret': secret,
      },
      body: JSON.stringify({ code, redirect_uri: CALLBACK }),
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok || !payload?.success || !payload?.data?.apiKey) {
      throw new Error(payload?.message || '无法交换授权码');
    }

    const apiKey = String(payload.data.apiKey);
    const username =
      usernameFromTokenPayload(payload.data) ||
      (await fetchUsernameForApiKey(apiKey));

    const home = new URL('/', req.url);
    home.searchParams.set('connected', '1');
    const result = NextResponse.redirect(home);
    clearVaultCookie(result);
    result.cookies.set({
      name: KEY_COOKIE,
      value: apiKey,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    if (username) {
      result.cookies.set({
        name: USERNAME_COOKIE,
        value: username.slice(0, 120),
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    result.cookies.set({
      name: STATE_COOKIE,
      value: '',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return result;
  } catch (error: any) {
    return redirectWithError(req, error?.message || '授权失败');
  }
}
