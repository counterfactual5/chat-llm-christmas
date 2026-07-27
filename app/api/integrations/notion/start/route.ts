import { NextRequest, NextResponse } from 'next/server';
import {
  NOTION_OAUTH_STATE_COOKIE,
  buildNotionAuthorizeUrl,
  notionOAuthConfigured,
  notionRedirectUri,
  resolveOwnerId,
} from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 20;

const API_KEY_COOKIE = 'llm_chat_api_key';

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function GET(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    const home = new URL('/', req.url);
    home.searchParams.set('notion_auth', '1');
    home.searchParams.set('auth_error', '请先连接 llm.christmas 账号，再绑定 Notion。');
    return NextResponse.redirect(home);
  }

  if (!notionOAuthConfigured()) {
    const home = new URL('/', req.url);
    home.searchParams.set('notion_auth', '1');
    home.searchParams.set(
      'auth_error',
      '服务器未配置 NOTION_CLIENT_ID / NOTION_CLIENT_SECRET。',
    );
    return NextResponse.redirect(home);
  }

  const clientId = process.env.NOTION_CLIENT_ID!.trim();
  const redirectUri = notionRedirectUri(req.url);
  const state = randomState();
  const authorize = buildNotionAuthorizeUrl({ clientId, redirectUri, state });

  const response = NextResponse.redirect(authorize);
  const apiKey = req.cookies.get(API_KEY_COOKIE)?.value?.trim() || '';
  if (apiKey.startsWith('sk-') && apiKey.length >= 20) {
    // Refresh binding cookie as Lax so it is sent on the Notion OAuth return navigation.
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
    name: NOTION_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });
  return response;
}
