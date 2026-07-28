import { NextRequest, NextResponse } from 'next/server';
import {
  buildGoogleAuthorizeUrl,
  createSignedGoogleOAuthState,
  googleOAuthConfigured,
  googleOAuthRedirectUri,
  resolveOwnerId,
} from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 30;

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

  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!.trim();
    const state = await createSignedGoogleOAuthState(ownerId);
    const redirectUri = googleOAuthRedirectUri(req.url);
    const authorize = buildGoogleAuthorizeUrl({ clientId, redirectUri, state });
    // No state cookie: signed state travels in the OAuth URL itself.
    return NextResponse.redirect(authorize);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Google 授权启动失败';
    const home = new URL('/', req.url);
    home.searchParams.set('google_auth', '1');
    home.searchParams.set('auth_error', message.slice(0, 180));
    return NextResponse.redirect(home);
  }
}
