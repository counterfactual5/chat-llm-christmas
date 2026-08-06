import { NextRequest, NextResponse } from 'next/server';
import { chatBackendResearchURL } from '@/lib/chat-backend';
import { researchDomainPayload } from '@/lib/chat/server/domain-policy';

export const runtime = 'edge';

function authHeaders(req: NextRequest): HeadersInit | null {
  const key = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!key) return null;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
}

/** POST /api/research — create deep research job */
export async function POST(req: NextRequest) {
  const headers = authHeaders(req);
  if (!headers) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }
  try {
    const incoming = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const query = String(incoming?.query || '').trim();
    const mode = String(incoming?.mode || '').trim() || undefined;
    const { domainContext, domainPolicy } = researchDomainPayload(query, mode);
    const priorContext =
      incoming?.context && typeof incoming.context === 'object' && !Array.isArray(incoming.context)
        ? (incoming.context as Record<string, unknown>)
        : {};

    // Domain classification lives only in this frontend server module.
    // Persist a snapshot so the chat-api worker never re-classifies the query.
    const body = {
      ...incoming,
      query,
      domainContext,
      context: {
        ...priorContext,
        domainContext,
        domainPolicy,
      },
    };

    const upstream = await fetch(chatBackendResearchURL(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
