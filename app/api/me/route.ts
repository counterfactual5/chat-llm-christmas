import { NextRequest } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 15;

const MAIN_SITE_USER_URL = 'https://llm.christmas/api/user/self';

function cookieNames(header: string): string[] {
  if (!header) return [];
  return header
    .split(';')
    .map((part) => part.trim().split('=')[0])
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const cookie = req.headers.get('cookie') || '';
  const names = cookieNames(cookie);

  if (!cookie) {
    return Response.json(
      {
        authenticated: false,
        reason: 'no_cookie_on_chat_request',
        cookie_names: [],
      },
      { status: 401 }
    );
  }

  try {
    const upstream = await fetch(MAIN_SITE_USER_URL, {
      headers: {
        Cookie: cookie,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!upstream.ok) {
      return Response.json(
        {
          authenticated: false,
          reason: 'main_site_rejected_cookie',
          cookie_names: names,
          upstream_status: upstream.status,
        },
        { status: 401 }
      );
    }

    const payload = await upstream.json();
    const user = payload?.data || payload?.user || null;

    if (!user) {
      return Response.json(
        {
          authenticated: false,
          reason: 'main_site_no_user_payload',
          cookie_names: names,
        },
        { status: 401 }
      );
    }

    return Response.json({
      authenticated: true,
      cookie_names: names,
      user: {
        id: user.id,
        username: user.username || user.display_name || user.email || `User #${user.id}`,
        quota: user.quota,
        used_quota: user.used_quota,
        group: user.group,
      },
    });
  } catch {
    return Response.json(
      {
        authenticated: false,
        reason: 'upstream_fetch_failed',
        cookie_names: names,
      },
      { status: 502 }
    );
  }
}
