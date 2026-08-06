/**
 * Pre-send context token estimate for compact / refuse decisions.
 *
 * `contextBreakdown.system` must already be the isomorphic full system
 * assembly for the thread being sent (skills + reference + tools guidance
 * inside). Callers that truncate history (edit/resend) must rebuild system
 * from that history before calling this.
 */

import { messagePlainText } from '@/lib/chat/message/display';
import type { Message } from '@/lib/chat/types';
import { estimateTokensFromText } from '@/lib/models/specs';

export type SendEstimateInput = {
  history: Message[];
  nextUserText: string;
  pendingImageCount: number;
  contextBreakdown: { system: number; skills?: number };
};

/**
 * Project tokens for the next send.
 * `nextUserText` should already embed attached text files — do not double-count files.
 */
export function estimateTokensForSend(input: SendEstimateInput): number {
  void input.contextBreakdown.skills;
  const historyText = input.history.reduce(
    (sum, m) => sum + estimateTokensFromText(messagePlainText(m)) + 4,
    0,
  );
  const historyImages = input.history.reduce(
    (sum, m) => sum + (m.images?.length || 0) * 1000,
    0,
  );
  return (
    input.contextBreakdown.system +
    historyText +
    historyImages +
    input.pendingImageCount * 1000 +
    estimateTokensFromText(input.nextUserText)
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
