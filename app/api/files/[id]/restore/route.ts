import { NextRequest } from 'next/server';
import { filesGatewayBaseURL } from '@/lib/files/gateway';

export const runtime = 'edge';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/** Proxy chat-api snapshot restore for UI Undo (cookie auth). */
export async function POST(req: NextRequest, { params }: Params) {
  const apiKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!apiKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const fileId = decodeURIComponent(id || '').trim();
  if (!fileId) {
    return Response.json({ error: 'Missing file id' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const snapshotId = String(
    (body as { snapshot_id?: string; snapshotId?: string })?.snapshot_id ||
      (body as { snapshotId?: string })?.snapshotId ||
      '',
  ).trim();
  if (!snapshotId) {
    return Response.json({ error: 'Missing snapshot_id' }, { status: 400 });
  }

  const res = await fetch(
    `${filesGatewayBaseURL()}/files/${encodeURIComponent(fileId)}/restore`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ snapshot_id: snapshotId }),
    },
  );
  const detail = await res.text().catch(() => '');
  if (!res.ok) {
    let message = detail || `Restore failed (${res.status})`;
    try {
      const parsed = JSON.parse(detail) as {
        error?: string | { message?: string };
        message?: string;
      };
      message =
        (typeof parsed.error === 'object' && parsed.error?.message) ||
        (typeof parsed.error === 'string' ? parsed.error : null) ||
        parsed.message ||
        message;
    } catch {
      /* keep text */
    }
    return Response.json(
      { error: message },
      { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
    );
  }
  try {
    const parsed = JSON.parse(detail || '{}') as {
      ok?: boolean;
      extract_error?: string | null;
    };
    if (parsed.ok === false || parsed.extract_error) {
      return Response.json(
        {
          error: parsed.extract_error || 'Restore extract rebuild failed',
          ok: false,
          extract_error: parsed.extract_error || null,
        },
        { status: 502 },
      );
    }
  } catch {
    /* forward raw body */
  }
  return new Response(detail || JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/json',
    },
  });
}
