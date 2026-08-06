/** Explicit claim-review command: `/review` or `/审查`, optional focus text.
 *
 * Edit/resend of a `/review` bubble must pass `baseMessages` (thread before that
 * turn) into `requestClaimReview` — same as `/research` / `/papers`. Truncating
 * only via `setSessions` leaves `sessionsRef` stale for the same-tick append.
 */
const REVIEW_CMD_RE = /^(?:\/review|\/审查)(?:\s+([\s\S]*))?$/i;

export type ReviewCommand = {
  /** Extra instructions from the user (may be empty). */
  focus: string;
};

/** Returns review command payload if the text is `/review` (with optional focus). */
export function parseReviewCommand(text: string): ReviewCommand | null {
  const m = String(text || '').trim().match(REVIEW_CMD_RE);
  if (!m) return null;
  return { focus: (m[1] || '').trim() };
}

export function isReviewCommandPrefix(text: string): boolean {
  return /^(?:\/review|\/审查)\s*$/i.test(String(text || '').trim());
}
