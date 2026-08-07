/**
 * Pre-send context token estimate for compact / refuse decisions.
 *
 * `contextBreakdown.system` must already be the isomorphic full system
 * assembly for the thread being sent (skills + reference + tools guidance
 * inside). Callers that truncate history (edit/resend) must rebuild system
 * from that history before calling this.
 */

import type { Message } from '@/lib/chat/types';
import { estimateHistoryTokens } from '@/lib/chat/turn/history-estimate';
import { estimateTokensFromText } from '@/lib/models/specs';
import {
  sendProjectionFromEstimateAndMeasured,
  type MeasuredTurnUsage,
} from '@/lib/chat/turn/context-occupancy';

export type SendEstimateInput = {
  history: Message[];
  nextUserText: string;
  pendingImageCount: number;
  contextBreakdown: { system: number; skills?: number };
  /** Gateway usage from the last finished completion — floors the projection. */
  measuredLastTurn?: MeasuredTurnUsage | null;
};

/**
 * Project tokens for the next send.
 * `nextUserText` should already embed attached text files — do not double-count files.
 * When measured usage is present, never project below last prompt+completion+this user.
 */
export function estimateTokensForSend(input: SendEstimateInput): number {
  void input.contextBreakdown.skills;
  const historyText = estimateHistoryTokens(input.history);
  const historyImages = input.history.reduce(
    (sum, m) => sum + (m.images?.length || 0) * 1000,
    0,
  );
  const nextUser =
    estimateTokensFromText(input.nextUserText) + input.pendingImageCount * 1000;
  const raw =
    input.contextBreakdown.system +
    historyText +
    historyImages +
    nextUser;
  return sendProjectionFromEstimateAndMeasured(
    raw,
    input.measuredLastTurn,
    nextUser,
  );
}

/** Soft threshold that triggers compact before send. */
export function shouldCompactBeforeSend(projected: number, usableLimit: number): boolean {
  return projected > usableLimit * 0.9;
}

/** Hard refuse after compact when still over the window. */
export function exceedsUsableWindow(projected: number, usableLimit: number): boolean {
  return projected > usableLimit;
}
