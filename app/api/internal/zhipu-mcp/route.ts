/**
 * Node.js proxy for Zhipu Coding Plan MCP.
 *
 * Chat runs on Edge; direct Edge → open.bigmodel.cn often gets HTML 405.
 * This route runs in the Node serverless runtime and performs the MCP call.
 */

import { NextRequest, NextResponse } from 'next/server';
import { zhipuMcpWebSearch } from '@/lib/tools/search/zhipu';
import { zhipuMcpWebRead } from '@/lib/tools/web-read/zhipu';
import { zhipuApiKey } from '@/lib/tools/zhipu/credentials';
import { formatUnknownError } from '@/lib/tools/zhipu/mcp-helpers';

export const runtime = 'nodejs';
export const maxDuration = 60;
/** Prefer Asia regions closer to open.bigmodel.cn. */
export const preferredRegion = ['hkg1', 'sin1'];

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
}

function assertInternal(req: NextRequest): boolean {
  const expected =
    process.env.INTERNAL_PROVIDER_SECRET?.trim() ||
    process.env.ZHIPU_CODING_API_KEY?.trim() ||
    process.env.ZHIPU_API_KEY?.trim() ||
    '';
  if (!expected) return false;
  const got = req.headers.get('x-christmas-internal')?.trim() || '';
  return got.length > 0 && got === expected;
}

export async function POST(req: NextRequest) {
  if (!assertInternal(req)) return unauthorized();
  if (!zhipuApiKey()) {
    return NextResponse.json(
      { ok: false, error: 'ZHIPU_CODING_API_KEY missing' },
      { status: 503 },
    );
  }

  let body: { action?: string; query?: string; url?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const action = String(body.action || '').trim();
  try {
    if (action === 'search') {
      const query = String(body.query || '').trim();
      if (!query) {
        return NextResponse.json({ ok: false, error: 'Missing query' }, { status: 400 });
      }
      // forceDirect: this route is Node — never re-enter the Edge→proxy hop.
      const hits = await zhipuMcpWebSearch(query, { forceDirect: true });
      return NextResponse.json({ ok: true, hits });
    }
    if (action === 'read') {
      const url = String(body.url || '').trim();
      if (!url) {
        return NextResponse.json({ ok: false, error: 'Missing url' }, { status: 400 });
      }
      const page = await zhipuMcpWebRead(url, { forceDirect: true });
      return NextResponse.json({ ok: true, page });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const message = formatUnknownError(err);
    console.warn('[zhipu-mcp proxy]', action, message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
