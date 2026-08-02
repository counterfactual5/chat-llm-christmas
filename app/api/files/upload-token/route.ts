import { NextRequest } from 'next/server';
import { filesGatewayBaseURL } from '@/lib/files/gateway';

export const runtime = 'edge';
export const maxDuration = 20;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Mint a short-lived upload ticket using the HttpOnly sk- cookie.
 * The browser then POSTs multipart directly to chat-api (bypassing Vercel body limits).
 */
export async function POST(req: NextRequest) {
  const apiKey = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!apiKey) {
    return json({ error: 'Sign in to upload files.' }, 401);
  }

  try {
    const base = filesGatewayBaseURL().replace(/\/$/, '');
    const upstream = await fetch(`${base}/files/upload-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttlSec: 300 }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return json(
        {
          error:
            (data as { error?: string; message?: string })?.error ||
            (data as { message?: string })?.message ||
            `Upload token failed (HTTP ${upstream.status})`,
        },
        upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      );
    }
    return json({
      uploadToken: String((data as { uploadToken?: string }).uploadToken || ''),
      expiresAt: Number((data as { expiresAt?: number }).expiresAt) || 0,
      uploadUrl: String((data as { uploadUrl?: string }).uploadUrl || ''),
      maxBytes: Number((data as { maxBytes?: number }).maxBytes) || 20 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload token failed';
    return json({ error: message }, 502);
  }
}
