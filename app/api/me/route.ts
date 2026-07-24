import { NextRequest } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 15;

const MAIN_SITE_USER_URL = 'https://llm.christmas/api/user/self';

export async function GET(req: NextRequest) {
  const cookie = req.headers.get('cookie') || '';

  if (!cookie) {
    return Response.json({ authenticated: false }, { status: 401 });
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
      return Response.json({ authenticated: false }, { status: 401 });
    }

    const payload = await upstream.json();
    const user = payload?.data || payload?.user || null;

    if (!user) {
      return Response.json({ authenticated: false }, { status: 401 });
    }

    // Only expose profile fields required by the chat UI. Never return session data.
    return Response.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username || user.display_name || user.email || `User #${user.id}`,
        quota: user.quota,
        used_quota: user.used_quota,
        group: user.group,
      },
    });
  } catch {
    return Response.json({ authenticated: false }, { status: 502 });
  }
}
