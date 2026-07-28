import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeGoogleCode,
  fetchGoogleEmail,
  googleConnectionFromToken,
  googleOAuthRedirectUri,
  resolveOwnerId,
  verifySignedGoogleOAuthState,
} from '@/lib/integrations';
import { encryptJson } from '@/lib/integrations/crypto';
import { integrationsSecret } from '@/lib/integrations/identity';
import type { GoogleConnection } from '@/lib/integrations/types';

export const runtime = 'edge';
export const maxDuration = 30;

function redirectHome(req: NextRequest, params: Record<string, string>) {
  const url = new URL('/', req.url);
  url.searchParams.set('google_auth', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/**
 * After exchanging the code, hand the encrypted connection to a same-origin POST.
 * Document form POST + Set-Cookie is far more reliable than Set-Cookie on an OAuth
 * callback response (browsers often drop cookies on the Google return navigation).
 */
function handoffFormHtml(payload: string) {
  const safePayload = payload
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connecting Google…</title></head><body>
<p>Connecting Google…</p>
<form id="f" method="POST" action="/api/integrations/google/finish">
<input type="hidden" name="payload" value="${safePayload}" />
</form>
<script>document.getElementById('f').submit()</script>
</body></html>`;
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

    if (!google.refreshToken && !google.accessToken) {
      return redirectHome(req, { auth_error: 'Google 未返回可用 token，请重试。' });
    }

    // Short-lived encrypted handoff blob (owner-bound). Consumed by /finish via form POST.
    const handoff = await encryptJson(
      {
        ownerId,
        google,
        exp: Date.now() + 5 * 60 * 1000,
      } satisfies { ownerId: string; google: GoogleConnection; exp: number },
      integrationsSecret(),
    );

    return new NextResponse(handoffFormHtml(handoff), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Google 授权失败';
    return redirectHome(req, { auth_error: message.slice(0, 180) });
  }
}
