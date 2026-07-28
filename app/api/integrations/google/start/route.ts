import { NextRequest, NextResponse } from 'next/server';
import {
  buildGoogleAuthorizeUrl,
  generateGoogleOAuthState,
  googleOAuthConfigured,
  googleOAuthRedirectUri,
  resolveOwnerId,
} from '@/lib/integrations';
import { GOOGLE_OAUTH_STATE_COOKIE } from '@/lib/integrations/types';

export const runtime = 'edge';
export const maxDuration = 30;

const API_KEY_COOKIE = 'llm_chat_api_key';

export async function GET(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    const home = new URL('/', req.url);
    home.searchParams.set('google_auth', '1');
    home.searchParams.set('auth_error', '请先连接 llm.christmas 账号，再绑定 Google。');
    return NextResponse.redirect(home);
  }

  if (!googleOAuthConfigured()) {
    const home = new URL('/', req.url);
    home.searchParams.set('google_auth', '1');
    home.searchParams.set(
      'auth_error',
      '服务器未配置 Google OAuth（GOOGLE_OAUTH_CLIENT_ID/SECRET）。',
    );
    return NextResponse.redirect(home);
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!.trim();
  const state = generateGoogleOAuthState();
  const redirectUri = googleOAuthRedirectUri(req.url);
  const authorize = buildGoogleAuthorizeUrl({ clientId, redirectUri, state });

  // Return an HTML page that sets the cookie via a 200 response, then redirects.
  // Some browsers (Safari, Arc, Brave) silently drop Set-Cookie on 302 redirects
  // to a cross-origin destination (Google). A 200 response is always honoured.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${authorize}"><title>Redirecting…</title></head><body><p>Redirecting to Google…</p><script>location.replace(${JSON.stringify(authorize)})</script></body></html>`;
  const response = new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  const apiKey = req.cookies.get(API_KEY_COOKIE)?.value?.trim() || '';
  if (apiKey.startsWith('sk-') && apiKey.length >= 20) {
    response.cookies.set({
      name: API_KEY_COOKIE,
      value: apiKey,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  response.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });
  return response;
}
