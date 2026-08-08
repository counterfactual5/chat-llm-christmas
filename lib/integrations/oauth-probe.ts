/**
 * Shared JSON shape for /api/integrations/<provider>/probe routes.
 */

import { NextResponse } from 'next/server';

export function probeAuthRequired(message: string) {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function probeTokenUnavailable(message = 'OAuth token unavailable.') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function probeOk(opts: {
  usable: boolean;
  mode?: string;
  results?: unknown;
  hint?: string;
  allUsable?: boolean;
}) {
  return NextResponse.json({
    connected: true,
    mode: opts.mode || 'oauth',
    usable: opts.usable,
    ...(opts.allUsable !== undefined ? { allUsable: opts.allUsable } : {}),
    ...(opts.results !== undefined ? { results: opts.results } : {}),
    ...(opts.hint ? { hint: opts.hint } : {}),
  });
}
