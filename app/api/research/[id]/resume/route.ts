import { NextRequest, NextResponse } from 'next/server';
import { chatBackendResearchURL } from '@/lib/chat-backend';

export const runtime = 'edge';

/** POST /api/research/:id/resume — requeue the same job from saved checkpoints. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const key = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!key) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const upstream = await fetch(`${chatBackendResearchURL(id)}/resume`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      cache: 'no-store',
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
