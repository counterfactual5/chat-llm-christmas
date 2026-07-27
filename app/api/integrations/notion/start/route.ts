import { NextRequest, NextResponse } from 'next/server';
import {
  NOTION_MCP_PKCE_COOKIE,
  NOTION_OAUTH_STATE_COOKIE,
  buildNotionMcpAuthorizeUrl,
  discoverNotionMcpOAuthMetadata,
  encodePkceCookie,
  generateOAuthState,
  generatePkcePair,
  notionMcpOAuthConfigured,
  notionMcpRedirectUri,
  resolveNotionMcpClientId,
  resolveOwnerId,
} from '@/lib/integrations';

export const runtime = 'edge';
export const maxDuration = 30;

const API_KEY_COOKIE = 'llm_chat_api_key';

export async function GET(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    const home = new URL('/', req.url);
    home.searchParams.set('notion_auth', '1');
    home.searchParams.set('auth_error', '请先连接 llm.christmas 账号，再绑定 Notion。');
    return NextResponse.redirect(home);
  }

  if (!notionMcpOAuthConfigured()) {
    const home = new URL('/', req.url);
    home.searchParams.set('notion_auth', '1');
    home.searchParams.set('auth_error', '服务器未启用 Notion MCP OAuth。');
    return NextResponse.redirect(home);
  }

  try {
    const redirectUri = notionMcpRedirectUri(req.url);
    const metadata = await discoverNotionMcpOAuthMetadata();
    const clientId = await resolveNotionMcpClientId(metadata, redirectUri);
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    const state = generateOAuthState();
    const authorize = buildNotionMcpAuthorizeUrl({
      authorizationEndpoint: metadata.authorization_endpoint,
      clientId,
      redirectUri,
      state,
      codeChallenge,
      scope: metadata.scopes_supported?.[0] || 'default',
    });

    const response = NextResponse.redirect(authorize);
    const apiKey = req.cookies.get(API_KEY_COOKIE)?.value?.trim() || '';
    if (apiKey.startsWith('sk-') && apiKey.length >= 20) {
      // Refresh binding cookie as Lax so it is sent on the OAuth return navigation.
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
    response.cookies.set({
      name: NOTION_MCP_PKCE_COOKIE,
      value: encodePkceCookie({
        state,
        codeVerifier,
        clientId,
        tokenEndpoint: metadata.token_endpoint,
        authorizationEndpoint: metadata.authorization_endpoint,
      }),
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    });
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Notion MCP OAuth start failed';
    const home = new URL('/', req.url);
    home.searchParams.set('notion_auth', '1');
    home.searchParams.set('auth_error', message.slice(0, 180));
    return NextResponse.redirect(home);
  }
}
