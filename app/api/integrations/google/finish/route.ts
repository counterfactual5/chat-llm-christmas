import { NextRequest, NextResponse } from 'next/server';
import {
  resolveOwnerId,
  upsertGoogleConnection,
} from '@/lib/integrations';
import { decryptJson } from '@/lib/integrations/crypto';
import { integrationsSecret } from '@/lib/integrations/identity';
import type { GoogleConnection } from '@/lib/integrations/types';

export const runtime = 'edge';
export const maxDuration = 30;

type HandoffPayload = {
  ownerId: string;
  google: GoogleConnection;
  exp: number;
};

function redirectHome(req: NextRequest, params: Record<string, string>) {
  const url = new URL('/', req.url);
  url.searchParams.set('google_auth', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  const ownerId = await resolveOwnerId(req);
  if (!ownerId) {
    return redirectHome(req, {
      auth_error: '授权回来时账号会话已失效，请重新连接后再绑定 Google。',
    });
  }

  let payloadRaw = '';
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = (await req.json()) as { payload?: string };
      payloadRaw = body.payload || '';
    } else {
      const form = await req.formData();
      const value = form.get('payload');
      payloadRaw = typeof value === 'string' ? value : '';
    }
  } catch {
    return redirectHome(req, { auth_error: 'Google 授权数据无效，请重试。' });
  }

  if (!payloadRaw) {
    return redirectHome(req, { auth_error: 'Google 授权数据缺失，请重试。' });
  }

  const handoff = await decryptJson<HandoffPayload>(payloadRaw, integrationsSecret());
  if (!handoff?.google || handoff.ownerId !== ownerId) {
    return redirectHome(req, { auth_error: 'Google 授权数据校验失败，请重试。' });
  }
  if (typeof handoff.exp !== 'number' || Date.now() > handoff.exp) {
    return redirectHome(req, { auth_error: 'Google 授权已过期，请重试。' });
  }

  try {
    // Success: go home with google_connected only (no google_auth modal reopen).
    const home = NextResponse.redirect(new URL('/?google_connected=1', req.url));
    await upsertGoogleConnection(req, home, ownerId, handoff.google);
    return home;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Google 保存失败';
    return redirectHome(req, { auth_error: message.slice(0, 180) });
  }
}
