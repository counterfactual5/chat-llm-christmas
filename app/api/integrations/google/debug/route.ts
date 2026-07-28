import { NextRequest, NextResponse } from 'next/server';
import { resolveOwnerId } from '@/lib/integrations';
import { GOOGLE_OAUTH_STATE_COOKIE } from '@/lib/integrations/types';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const allCookieNames = Array.from(req.cookies.getAll()).map((c) => c.name);
  const stateCookie = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value || '';
  const ownerId = await resolveOwnerId(req);
  const apiKeyCookie = req.cookies.get('llm_chat_api_key')?.value || '';

  return NextResponse.json({
    stateCookiePresent: Boolean(stateCookie),
    stateCookieLength: stateCookie.length,
    ownerIdPresent: Boolean(ownerId),
    apiKeyCookiePresent: Boolean(apiKeyCookie),
    apiKeyCookiePrefix: apiKeyCookie.slice(0, 6),
    allCookieNames,
    googleClientIdConfigured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()),
    googleClientSecretConfigured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()),
    chatSsoSecretConfigured: Boolean(process.env.CHAT_SSO_SECRET?.trim()),
  });
}
