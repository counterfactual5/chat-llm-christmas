/**
 * Prefer gateway-measured tokens as a floor under client estimates so the
 * Context bar and compact/refuse gates do not look "empty" while the last
 * real prompt was already larger.
 */

export type MeasuredTurnUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

function positiveInt(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

/**
 * Idle / panel occupancy after a finished turn.
 * Once the assistant replied, the window holds roughly last prompt + completion.
 */
export function occupancyFromEstimateAndMeasured(
  estimateTotal: number,
  measured?: MeasuredTurnUsage | null,
): number {
  const estimate = Math.max(0, Math.floor(Number(estimateTotal) || 0));
  const prompt = positiveInt(measured?.prompt_tokens);
  const completion = positiveInt(measured?.completion_tokens);
  if (!prompt && !completion) return estimate;
  return Math.max(estimate, prompt + completion);
}

/**
 * Pre-send projection floor: last measured exchange + this turn's new user
 * payload (text + pending images already folded into `sendEstimate`).
 */
export function sendProjectionFromEstimateAndMeasured(
  sendEstimate: number,
  measured?: MeasuredTurnUsage | null,
  /** Extra tokens for the new user turn not present in the last measured prompt. */
  nextUserExtraTokens = 0,
): number {
  const estimate = Math.max(0, Math.floor(Number(sendEstimate) || 0));
  const prompt = positiveInt(measured?.prompt_tokens);
  const completion = positiveInt(measured?.completion_tokens);
  if (!prompt && !completion) return estimate;
  const extra = Math.max(0, Math.floor(Number(nextUserExtraTokens) || 0));
  return Math.max(estimate, prompt + completion + extra);
}
