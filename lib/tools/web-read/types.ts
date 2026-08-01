/**
 * Shared web-read types and content limits.
 */

export type WebReadOutcome = {
  provider: string;
  url: string;
  title?: string;
  description?: string;
  content: string;
  error?: string;
};

export const MAX_CONTENT_CHARS = 48_000;
export const MIN_EXTRACT_CHARS = 40;
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const BARE_FETCH_TIMEOUT_MS = 15_000;
export const PROVIDER_FETCH_TIMEOUT_MS = 25_000;
/** Cap HTML body read so one huge page cannot OOM the Edge isolate. */
export const MAX_FETCH_BYTES = 2_500_000;

export function truncateContent(text: string): string {
  const t = String(text || '').trim();
  if (t.length <= MAX_CONTENT_CHARS) return t;
  return `${t.slice(0, MAX_CONTENT_CHARS)}\n\n…[truncated]`;
}
