/**
 * Shared helpers for Zhipu-related tooling.
 * Search / web-read MCP now run on chat-api; this file keeps error formatting
 * used by remaining Christmas tools and tests.
 */

/** Prefer a readable string over "[object Object]" in logs / thrown Errors. */
export function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    const msg = String(err.message || '').trim();
    return msg || err.name || 'Error';
  }
  if (typeof err === 'string') return err.trim() || 'Error';
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    for (const key of ['message', 'error', 'msg', 'detail']) {
      const v = rec[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v === 'object') {
        const nested = formatUnknownError(v);
        if (nested && nested !== '[object Object]') return nested;
      }
    }
    try {
      return JSON.stringify(err).slice(0, 400);
    } catch {
      // fall through
    }
  }
  return String(err || 'Error');
}
