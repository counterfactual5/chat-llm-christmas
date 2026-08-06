/**
 * Shared done-run tool receipt shape for API replay and token estimates.
 * Keep caps in sync with history serialization in `toApiMessages`.
 */

import type { MessageToolRun } from '@/lib/chat/types';

export const TOOL_RECEIPT_MAX_RESULTS = 8;
export const TOOL_RECEIPT_SNIPPET_CHARS = 240;
export const TOOL_RECEIPT_BODY_CHARS = 16_000;

/** Runs that are replayed as tool_calls + tool messages (not UI-only). */
export function isReplayableToolRun(
  run: MessageToolRun | undefined | null,
): run is MessageToolRun {
  return Boolean(
    run?.name && run.name !== 'claim_reviewer' && run.status === 'done',
  );
}

export function filterReplayableToolRuns(
  runs: MessageToolRun[] | undefined,
): MessageToolRun[] {
  return (runs || []).filter(isReplayableToolRun);
}

/** Payload object before JSON.stringify — mirrors `toApiMessages` tool content. */
export function buildToolReceiptPayload(run: MessageToolRun): Record<string, unknown> {
  if (run.error) {
    return {
      ok: false,
      error: run.error,
      ...(run.query ? { query: run.query } : {}),
    };
  }
  return {
    ok: true,
    ...(run.query ? { query: run.query } : {}),
    ...(run.provider ? { provider: run.provider } : {}),
    ...(run.results?.length
      ? {
          results: run.results.slice(0, TOOL_RECEIPT_MAX_RESULTS).map((x) => ({
            title: x.title,
            url: x.url,
            snippet: String(x.snippet || '').slice(0, TOOL_RECEIPT_SNIPPET_CHARS),
            ...(x.body
              ? { content: String(x.body).slice(0, TOOL_RECEIPT_BODY_CHARS) }
              : {}),
          })),
        }
      : {}),
  };
}

export function serializeToolReceipt(run: MessageToolRun): string {
  return JSON.stringify(buildToolReceiptPayload(run));
}

export function buildHistoryToolCalls(
  runs: MessageToolRun[],
  messageId: string,
): Array<{
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}> {
  return runs.map((r, idx) => ({
    id: String(r.id || `hist_${messageId}_${idx}`),
    type: 'function' as const,
    function: {
      name: r.name,
      arguments: JSON.stringify(historyToolCallArgs(r)),
    },
  }));
}

/** Replay args shaped for each tool’s schema (not a one-size `{query}`). */
function historyToolCallArgs(run: MessageToolRun): Record<string, unknown> {
  const q = String(run.query || '').trim();
  if (/^web[_-]?read$/i.test(run.name)) {
    if (/^https?:\/\//i.test(q)) return { url: q };
    return q ? { url: q } : {};
  }
  if (/^(web_search|news_search|wiki_search|proactive_search)$/i.test(run.name)) {
    return q ? { query: q } : {};
  }
  if (/^image_generate$/i.test(run.name)) {
    return q ? { prompt: q } : {};
  }
  if (/^image_understand$/i.test(run.name)) {
    return q ? { image_url: q } : {};
  }
  // Generic fallback: keep prior behavior for search-like tools / unknown.
  return q ? { query: q } : {};
}
