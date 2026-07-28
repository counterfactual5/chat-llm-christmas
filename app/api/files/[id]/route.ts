import { NextRequest } from 'next/server';
import { gatewayBaseURL } from '@/lib/gateway-files';

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

  const baseURL = gatewayBaseURL();
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
