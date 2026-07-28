import { NextRequest, NextResponse } from 'next/server';
import {
  buildGitHubAuthorizeUrl,
  generateGitHubOAuthState,
  githubOAuthConfigured,
  githubOAuthRedirectUri,
  resolveOwnerId,
} from '@/lib/integrations';
import { GITHUB_OAUTH_STATE_COOKIE } from '@/lib/integrations/types';

export const runtime = 'edge';
export const maxDuration = 30;

const API_KEY_COOKIE = 'llm_chat_api_key';

export async function GET(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    const home = new URL('/', req.url);
    home.searchParams.set('github_auth', '1');
    home.searchParams.set('auth_error', '请先连接 llm.christmas 账号，再绑定 GitHub。');
    return NextResponse.redirect(home);
  }

  if (!githubOAuthConfigured()) {
    const home = new URL('/', req.url);
    home.searchParams.set('github_auth', '1');
    home.searchParams.set('auth_error', '服务器未配置 GitHub OAuth（GITHUB_OAUTH_CLIENT_ID/SECRET）。');
    return NextResponse.redirect(home);
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID!.trim();
  const state = generateGitHubOAuthState();
  const redirectUri = githubOAuthRedirectUri(req.url);
  const authorize = buildGitHubAuthorizeUrl({ clientId, redirectUri, state });

  const response = NextResponse.redirect(authorize);
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
    name: GITHUB_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });
  return response;
}
