import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeGoogleCode,
  fetchGoogleEmail,
  googleConnectionFromToken,
  googleOAuthRedirectUri,
  resolveOwnerId,
  upsertGoogleConnection,
} from '@/lib/integrations';
import { GOOGLE_OAUTH_STATE_COOKIE } from '@/lib/integrations/types';

export const runtime = 'edge';
export const maxDuration = 30;

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function redirectHome(req: NextRequest, params: Record<string, string>) {
  const url = new URL('/', req.url);
  url.searchParams.set('google_auth', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || '';
  const state = req.nextUrl.searchParams.get('state') || '';
  const error = req.nextUrl.searchParams.get('error') || '';
  const expected = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value || '';

  if (error) {
    return redirectHome(req, { auth_error: `Google 授权取消或失败：${error}`.slice(0, 180) });
  }

  if (!code || !safeEqual(state, expected)) {
    return redirectHome(req, { auth_error: 'Google 授权状态无效，请重试。' });
  }

  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return redirectHome(req, {
      auth_error: '授权回来时账号会话已失效，请重新连接后再绑定 Google。',
    });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || '';
  if (!clientId || !clientSecret) {
    return redirectHome(req, { auth_error: 'Google OAuth 未配置。' });
  }

  try {
    const token = await exchangeGoogleCode({
      code,
      clientId,
      clientSecret,
      redirectUri: googleOAuthRedirectUri(req.url),
    });
    const email = await fetchGoogleEmail(token.access_token);
    const google = googleConnectionFromToken(token, email);

    const home = redirectHome(req, { google_connected: '1' });
    await upsertGoogleConnection(req, home, ownerId, google);
    home.cookies.set({
      name: GOOGLE_OAUTH_STATE_COOKIE,
      value: '',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return home;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Google 授权失败';
    return redirectHome(req, { auth_error: message.slice(0, 180) });
  }
}
