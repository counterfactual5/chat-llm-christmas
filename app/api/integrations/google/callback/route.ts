import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeGoogleCode,
  fetchGoogleEmail,
  googleConnectionFromToken,
  googleOAuthRedirectUri,
  readVault,
  resolveOwnerId,
  writeVaultCookie,
} from '@/lib/integrations';

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

  if (error) {
    return redirectHome(req, { auth_error: `Google 授权取消或失败：${error}`.slice(0, 180) });
  }

  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return redirectHome(req, {
      auth_error: '授权回来时账号会话已失效，请重新连接后再绑定 Google。',
    });
  }

  const vault = await readVault(req, ownerId);
  const expected = vault.googleOAuthState || '';

  if (!code || !safeEqual(state, expected)) {
    return redirectHome(req, { auth_error: 'Google 授权状态无效，请重试。' });
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
    const { googleOAuthState: _cleared, ...rest } = vault;
    await writeVaultCookie(home, { ...rest, ownerId, google });
    return home;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Google 授权失败';
    return redirectHome(req, { auth_error: message.slice(0, 180) });
  }
}
