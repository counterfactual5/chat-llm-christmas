import { NextRequest, NextResponse } from 'next/server';
import { chatBackendLiteratureURL } from '@/lib/chat-backend';

export const runtime = 'edge';
export const maxDuration = 120;

const BOOK_MIME_HINTS = ['pdf', 'epub', 'octet-stream', 'djvu', 'text/plain'];

/**
 * GET /api/literature/books/content?identifier=…
 * Proxy book bytes (no Files write) for ephemeral Preview.
 */
export async function GET(req: NextRequest) {
  const key = req.cookies.get('llm_chat_api_key')?.value || '';
  if (!key) {
    return NextResponse.json({ error: '请先连接主站账号' }, { status: 401 });
  }
  const identifier = String(req.nextUrl.searchParams.get('identifier') || '').trim();
  if (!identifier) {
    return NextResponse.json({ error: 'Missing identifier' }, { status: 400 });
  }
  try {
    const upstreamUrl = new URL(chatBackendLiteratureURL('books/content'));
    upstreamUrl.searchParams.set('identifier', identifier);
    const upstream = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const looksBook = BOOK_MIME_HINTS.some((h) => contentType.includes(h));
    if (!upstream.ok || !looksBook) {
      const data = await upstream.json().catch(async () => {
        const text = await upstream.text().catch(() => '');
        return {
          error: text.slice(0, 400) || `Book content failed (HTTP ${upstream.status})`,
        };
      });
      return NextResponse.json(data, { status: upstream.status });
    }
    const headers = new Headers();
    headers.set('Content-Type', contentType.split(';')[0].trim() || 'application/octet-stream');
    const disposition = upstream.headers.get('content-disposition');
    if (disposition) headers.set('Content-Disposition', disposition);
    headers.set('Cache-Control', 'private, max-age=300');
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '请求失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
