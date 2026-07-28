import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeGoogleCode,
  fetchGoogleEmail,
  googleConnectionFromToken,
  googleOAuthRedirectUri,
  resolveOwnerId,
  upsertGoogleConnection,
  verifySignedGoogleOAuthState,
} from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 30;

function redirectHome(req: NextRequest, params: Record<string, string>) {
  const url = new URL('/', req.url);
  url.searchParams.set('google_auth', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/** 200 HTML bridge so Set-Cookie is not dropped on a redirect response. */
function htmlRedirect(targetPath: string, responseInit?: ResponseInit) {
  const safeJs = JSON.stringify(targetPath);
  const safeMeta = targetPath.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safeMeta}"><title>Redirecting…</title></head><body><p>Redirecting…</p><script>location.replace(${safeJs})</script></body></html>`;
  return new NextResponse(html, {
    status: 200,
    ...responseInit,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...(responseInit?.headers || {}),
    },
  });
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || '';
  const state = req.nextUrl.searchParams.get('state') || '';
  const error = req.nextUrl.searchParams.get('error') || '';

  if (error) {
    return redirectHome(req, { auth_error: `Google 授权取消或失败：${error}`.slice(0, 180) });
  }

  if (!code) {
    return redirectHome(req, { auth_error: 'Google 授权状态无效（code 为空），请重试。' });
  }

  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return redirectHome(req, {
      auth_error: '授权回来时账号会话已失效，请重新连接后再绑定 Google。',
    });
  }

  const verified = await verifySignedGoogleOAuthState(state, ownerId);
  if (!verified.ok) {
    return redirectHome(req, {
      auth_error: `Google 授权状态无效（${verified.reason}），请重试。`,
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

    // Use a 200 HTML page to set the encrypted Google cookie, then jump home.
    // Avoids browsers dropping Set-Cookie on 302 redirect responses.
    const home = htmlRedirect('/?google_connected=1&google_auth=1');
    await upsertGoogleConnection(req, home, ownerId, google);
    return home;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Google 授权失败';
    return redirectHome(req, { auth_error: message.slice(0, 180) });
  }
}
