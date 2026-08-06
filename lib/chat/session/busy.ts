/**
 * Session "in progress" — SSOT for MessageList live chrome, Composer Stop,
 * Sidebar spinner, and orphan-tool cleanup.
 *
 * Chat turns and Deep Research both call beginLoading/endLoading, but Research
 * also keeps a `busy` flag across SSE reconnect gaps. OR them here once;
 * call sites must not invent a second busy predicate.
 */

export type SessionBusyInput = {
  loadingBySession: Record<string, boolean>;
  /** Session id of the in-flight Deep Research job, or null when idle. */
  researchBusySessionId: string | null;
};

/** Map Deep Research hook state → scoped session id (or null when idle). */
export function researchBusySessionIdFrom(
  busy: boolean,
  sessionId: string | null | undefined,
): string | null {
  if (!busy || !sessionId) return null;
  return sessionId;
}

export function isResearchSessionBusy(
  sessionId: string | null | undefined,
  researchBusySessionId: string | null,
): boolean {
  return Boolean(sessionId && researchBusySessionId === sessionId);
}

/**
 * Whether Composer Stop should call research cancel (not chat stopGenerating).
 * Unscoped busy (busy but no session id yet) still cancels — never chat-abort a
 * research turn.
 */
export function shouldCancelResearch(
  activeSessionId: string | null | undefined,
  researchBusy: boolean,
  researchBusySessionId: string | null,
): boolean {
  if (!researchBusy) return false;
  if (!researchBusySessionId) return true;
  return isResearchSessionBusy(activeSessionId, researchBusySessionId);
}

export function isSessionBusy(
  sessionId: string | null | undefined,
  input: SessionBusyInput,
): boolean {
  if (!sessionId) return false;
  if (input.loadingBySession[sessionId]) return true;
  return isResearchSessionBusy(sessionId, input.researchBusySessionId);
}
