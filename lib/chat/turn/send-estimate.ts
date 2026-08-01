/**
 * Pre-send context token estimate for compact / refuse decisions.
 */

import { messagePlainText } from '@/lib/chat/message/display';
import { formatWebSourcesForReference } from '@/lib/chat/context/references';
import type { Message, WebSearchSource } from '@/lib/chat/types';
import { estimateTokensFromText } from '@/lib/models/specs';

export type SendEstimateInput = {
  history: Message[];
  nextUserText: string;
  pendingImageCount: number;
  webSources: WebSearchSource[];
  contextBreakdown: { system: number; skills: number };
};

/**
 * Project tokens for the next send.
 * `nextUserText` should already embed attached text files — do not double-count files.
 */
export function estimateTokensForSend(input: SendEstimateInput): number {
  const threadReference = estimateTokensFromText(
    formatWebSourcesForReference(input.webSources || []),
  );
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
    input.contextBreakdown.skills +
    threadReference +
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
