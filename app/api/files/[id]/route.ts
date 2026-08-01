import { NextRequest } from 'next/server';
import { filesGatewayBaseURL } from '@/lib/files/gateway';

export const runtime = 'edge';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/** Proxy gateway file bytes for UI preview/download (auth via chat cookie). */
export async function GET(req: NextRequest, { params }: Params) {
  const apiKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id } = await params;
  const fileId = decodeURIComponent(id || '').trim();
  if (!fileId) {
    return new Response(JSON.stringify({ error: 'Missing file id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const baseURL = filesGatewayBaseURL();
  const res = await fetch(`${baseURL}/files/${encodeURIComponent(fileId)}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return new Response(
      JSON.stringify({
        error: detail || `Gateway file HTTP ${res.status}`,
      }),
      {
        status: res.status >= 400 && res.status < 600 ? res.status : 502,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buf = await res.arrayBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

/** Delete an account-scoped gateway file, then callers remove its chat reference. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const apiKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!apiKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const fileId = decodeURIComponent(id || '').trim();
  if (!fileId) {
    return Response.json({ error: 'Missing file id' }, { status: 400 });
  }

  const res = await fetch(
    `${filesGatewayBaseURL()}/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  const detail = await res.text().catch(() => '');
  if (!res.ok) {
    return Response.json(
      { error: detail || `Gateway file HTTP ${res.status}` },
      { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
    );
  }
  return new Response(detail || JSON.stringify({ deleted: true }), {
    status: 200,
    headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
  });
}
