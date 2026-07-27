import { NextRequest, NextResponse } from 'next/server';
import {
  NOTION_MCP_PKCE_COOKIE,
  NOTION_OAUTH_STATE_COOKIE,
  decodePkceCookie,
  exchangeNotionMcpCode,
  notionConnectionFromMcpToken,
  notionMcpRedirectUri,
  resolveOwnerId,
  upsertNotionConnection,
} from '@/lib/integrations';
import { NotionMcpClient } from '@/lib/notion/mcp-client';

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
  url.searchParams.set('notion_auth', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

function clearOauthCookies(response: NextResponse) {
  for (const name of [NOTION_OAUTH_STATE_COOKIE, NOTION_MCP_PKCE_COOKIE]) {
    response.cookies.set({
      name,
      value: '',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || '';
  const state = req.nextUrl.searchParams.get('state') || '';
  const error = req.nextUrl.searchParams.get('error') || '';
  const expected = req.cookies.get(NOTION_OAUTH_STATE_COOKIE)?.value || '';
  const pkceRaw = req.cookies.get(NOTION_MCP_PKCE_COOKIE)?.value || '';
  const pkce = decodePkceCookie(pkceRaw);

  if (error) {
    return redirectHome(req, { auth_error: `Notion 授权取消或失败：${error}`.slice(0, 180) });
  }

  if (!code || !pkce || !safeEqual(state, expected) || !safeEqual(state, pkce.state)) {
    return redirectHome(req, { auth_error: 'Notion 授权状态无效，请重试。' });
  }

  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return redirectHome(req, { auth_error: '授权回来时账号会话已失效，请重新连接后绑定 Notion。' });
  }

  try {
    const token = await exchangeNotionMcpCode({
      tokenEndpoint: pkce.tokenEndpoint,
      code,
      codeVerifier: pkce.codeVerifier,
      clientId: pkce.clientId,
      redirectUri: notionMcpRedirectUri(req.url),
    });

    let notion = notionConnectionFromMcpToken(token, undefined, {
      mcpClientId: pkce.clientId,
    });

    // Best-effort workspace label via MCP fetch(self) — MCP tokens are not REST-compatible.
    try {
      const client = new NotionMcpClient(notion.accessToken);
      const label = await client.fetchSelfLabel();
      if (label.workspaceName) {
        notion = { ...notion, workspaceName: label.workspaceName };
      }
    } catch {
      // non-fatal
    }

    const home = redirectHome(req, { notion_connected: '1' });
    await upsertNotionConnection(req, home, ownerId, notion);
    clearOauthCookies(home);
    return home;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Notion 授权失败';
    return redirectHome(req, {
      auth_error: message.slice(0, 180),
    });
  }
}
