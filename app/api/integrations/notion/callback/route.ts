import { NextRequest, NextResponse } from 'next/server';
import {
  NOTION_OAUTH_STATE_COOKIE,
  exchangeNotionCode,
  notionConnectionFromToken,
  notionRedirectUri,
  resolveOwnerId,
  upsertNotionConnection,
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
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || '';
  const state = req.nextUrl.searchParams.get('state') || '';
  const error = req.nextUrl.searchParams.get('error') || '';
  const expected = req.cookies.get(NOTION_OAUTH_STATE_COOKIE)?.value || '';

  if (error) {
    return redirectHome(req, { auth_error: `Notion 授权取消或失败：${error}`.slice(0, 180) });
  }

  if (!code || !safeEqual(state, expected)) {
    return redirectHome(req, { auth_error: 'Notion 授权状态无效，请重试。' });
  }

  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return redirectHome(req, { auth_error: '授权回来时账号会话已失效，请重新连接后绑定 Notion。' });
  }

  try {
    const token = await exchangeNotionCode({
      code,
      redirectUri: notionRedirectUri(req.url),
    });
    const notion = notionConnectionFromToken(token);
    const home = redirectHome(req, { notion_connected: '1' });
    await upsertNotionConnection(req, home, ownerId, notion);
    home.cookies.set({
      name: NOTION_OAUTH_STATE_COOKIE,
      value: '',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return home;
  } catch (err: any) {
    return redirectHome(req, {
      auth_error: String(err?.message || 'Notion 授权失败').slice(0, 180),
    });
  }
}
