/**
 * Blocked-embed detection + degrade decisions for the URL Preview panel.
 *
 * Pure helpers kept separate from `UrlPreviewPanel.tsx` so they can be unit
 * tested in node env (no DOM / React). Detection is heuristic only — JS
 * cannot read X-Frame-Options/CSP headers, so we probe the iframe document
 * and fall back to a settle timer (KTD1). Auto-switch to Text happens only
 * when the prefetched extract is already in hand (KTD2).
 */

/** Embed success probe result. */
export type EmbedProbeOutcome = 'ready' | 'likely-blocked' | 'unknown';

/** Minimal document surface the probe reads (real Document or test mock). */
export interface EmbedProbeDocumentLike {
  URL?: string;
  body?: { textContent?: string | null; innerHTML?: string } | null;
}

/** Minimal iframe surface the probe reads (real HTMLIFrameElement or mock). */
export interface EmbedProbeIframeLike {
  contentDocument?: EmbedProbeDocumentLike | null;
  contentWindow?: { document?: EmbedProbeDocumentLike | null } | null;
}

function documentLooksEmpty(doc: EmbedProbeDocumentLike): boolean {
  const url = String(doc.URL || '');
  if (url === 'about:blank' || url === 'about:srcdoc') return true;
  const body = doc.body;
  if (!body) return true;
  const text = String(body.textContent || '').trim();
  const html = String(body.innerHTML || '').trim();
  return !text && !html;
}

/**
 * Heuristic probe: did the iframe actually render a readable document?
 *
 * - `ready`: same-origin readable document with non-blank URL and content.
 * - `likely-blocked`: accessible `about:blank`/`about:srcdoc` document with
 *   an empty body — the shape Chrome/Edge produce for XFO/CSP refusals.
 * - `unknown`: document unavailable OR cross-origin inaccessible. A
 *   cross-origin page that embedded successfully also throws on
 *   `contentDocument`, so that shape MUST stay `unknown` (embed assumed
 *   working) — never `likely-blocked`.
 *
 * Never throws — all DOM access is guarded.
 */
export function probeEmbedOutcome(
  iframe: EmbedProbeIframeLike | null | undefined,
): EmbedProbeOutcome {
  if (!iframe) return 'unknown';
  let doc: EmbedProbeDocumentLike | null | undefined;
  try {
    doc = iframe.contentDocument ?? iframe.contentWindow?.document ?? null;
  } catch {
    // Cross-origin iframe doc — either a successful embed or an error page;
    // indistinguishable, so treat as working (no degrade).
    return 'unknown';
  }
  if (!doc) return 'unknown';
  try {
    return documentLooksEmpty(doc) ? 'likely-blocked' : 'ready';
  } catch {
    return 'unknown';
  }
}

export type PrefetchLikeStatus =
  | 'idle'
  | 'loading'
  | 'done'
  | 'error'
  /** Extract finished but the page has no open-access body. */
  | 'no-oa';

export type DegradeAction = 'wait' | 'auto-extract' | 'fallback';

/**
 * Decide what the panel should do once an embed looks blocked.
 *
 * - `wait`: embed is fine (never auto-switch), or the settle timer has not
 *   fired yet while extract is still loading (pending fallback, UI shows
 *   "may be blocked" hint under the iframe during the grace window).
 * - `auto-extract`: blocked + extract already done → switch to Text + notice.
 * - `fallback`: blocked + extract still loading past the grace window, or
 *   extract failed → replace the dead iframe with an actionable fallback.
 *
 * `settleFired` marks the settle timer (~2.5s) having elapsed; injected so
 * the transition is testable without fake timers.
 */
export function decideDegradeAction(input: {
  embedLikelyBlocked: boolean;
  prefetch: PrefetchLikeStatus;
  settleFired: boolean;
}): DegradeAction {
  if (!input.embedLikelyBlocked) return 'wait';
  if (input.prefetch === 'done') return 'auto-extract';
  // Failed extract or paywalled/no-OA body — no usable Text to switch to.
  if (input.prefetch === 'error' || input.prefetch === 'no-oa') return 'fallback';
  // prefetch idle/loading: give the in-flight prefetch a grace window.
  return input.settleFired ? 'fallback' : 'wait';
}

/** Timing knobs for the probe/settle path — kept in one place for tuning. */
export const EMBED_PROBE_TIMING = {
  /** Error documents settle async; probe once more shortly after load. */
  reProbeMs: 150,
  /** How long a blocked embed may wait for a still-loading prefetch. */
  settleMs: 2500,
} as const;
