import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeGitHubCode,
  fetchGitHubLogin,
  githubConnectionFromToken,
  githubOAuthRedirectUri,
  resolveOwnerId,
  upsertGitHubConnection,
} from '@/lib/integrations';
import { GITHUB_OAUTH_STATE_COOKIE } from '@/lib/integrations/types';

export const runtime = 'edge';
export const maxDuration = 30;

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function redirectHome(
  req: NextRequest,
  params: Record<string, string>,
  opts?: { openGitHubModal?: boolean },
) {
  const url = new URL('/', req.url);
  if (opts?.openGitHubModal !== false) {
    url.searchParams.set('github_auth', '1');
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || '';
  const state = req.nextUrl.searchParams.get('state') || '';
  const error = req.nextUrl.searchParams.get('error') || '';
  const expected = req.cookies.get(GITHUB_OAUTH_STATE_COOKIE)?.value || '';

  if (error) {
    return redirectHome(req, { auth_error: `GitHub 授权取消或失败：${error}`.slice(0, 180) });
  }

  if (!code || !safeEqual(state, expected)) {
    return redirectHome(req, { auth_error: 'GitHub 授权状态无效，请重试。' });
  }

  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return redirectHome(req, {
      auth_error: '授权回来时账号会话已失效，请重新连接后再绑定 GitHub。',
    });
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim() || '';
  if (!clientId || !clientSecret) {
    return redirectHome(req, { auth_error: 'GitHub OAuth 未配置。' });
  }

  try {
    const token = await exchangeGitHubCode({
      code,
      clientId,
      clientSecret,
      redirectUri: githubOAuthRedirectUri(req.url),
    });
    const login = await fetchGitHubLogin(token.access_token);
    const github = githubConnectionFromToken(token, login);

    const home = redirectHome(req, { github_connected: '1' }, { openGitHubModal: false });
    await upsertGitHubConnection(req, home, ownerId, github);
    home.cookies.set({
      name: GITHUB_OAUTH_STATE_COOKIE,
      value: '',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return home;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'GitHub 授权失败';
    return redirectHome(req, { auth_error: message.slice(0, 180) });
  }
}
