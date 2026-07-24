import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const STATE_COOKIE = 'llm_chat_oauth_state';
const CALLBACK = 'https://chat.llm.christmas/api/auth/callback';

export async function GET(req: NextRequest) {
  const state = crypto.randomUUID().replaceAll('-', '');
  const authorize = new URL('https://llm.christmas/chat/authorize');
  authorize.searchParams.set('redirect_uri', CALLBACK);
  authorize.searchParams.set('state', state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
