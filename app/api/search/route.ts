import { NextRequest } from 'next/server';
import { webSearch } from '@/lib/web-search';

export const runtime = 'edge';
export const maxDuration = 60;

/** Debug / direct search endpoint — same fallback chain as chat tools. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body?.query || body?.q || '').trim();
    if (!query) {
      return Response.json({ error: 'Missing query' }, { status: 400 });
    }
    const outcome = await webSearch(query);
    return Response.json(outcome, { status: outcome.results.length ? 200 : 502 });
  } catch (err: any) {
    return Response.json(
      { error: err?.message || 'Search failed' },
      { status: 500 },
    );
  }
}
