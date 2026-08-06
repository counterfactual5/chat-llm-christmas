/**
 * History token estimate isomorphic with `toApiMessages` tool expansion.
 * Does not change `messagePlainText` (display-only).
 */

import { messagePlainText } from '@/lib/chat/message/display';
import {
  buildHistoryToolCalls,
  filterReplayableToolRuns,
  serializeToolReceipt,
} from '@/lib/chat/message/tool-receipt';
import type { Message } from '@/lib/chat/types';
import { estimateTokensFromText } from '@/lib/models/specs';

/** Per-message role overhead (same +4 as legacy send/context reduces). */
const MSG_OVERHEAD = 4;

function estimateExpandedAssistantTokens(message: Message): number {
  const runs = filterReplayableToolRuns(message.toolRuns);
  const tool_calls = buildHistoryToolCalls(runs, message.id);
  let tokens = estimateTokensFromText(JSON.stringify(tool_calls));
  for (const run of runs) {
    tokens += estimateTokensFromText(serializeToolReceipt(run));
  }
  // Answer bubble: keep display plain text (content + reasoning) so we do not
  // undercount vs the previous estimator; API omits reasoning (known drift).
  tokens += estimateTokensFromText(messagePlainText(message));
  return tokens;
}

/** Tokens for one UI message as history (tools expanded when applicable). */
export function estimateMessageHistoryTokens(message: Message): number {
  if (
    message.role === 'assistant' &&
    filterReplayableToolRuns(message.toolRuns).length > 0
  ) {
    return estimateExpandedAssistantTokens(message);
  }
  return estimateTokensFromText(messagePlainText(message));
}

/** Sum history message tokens + per-message overhead. */
export function estimateHistoryTokens(messages: Message[]): number {
  return (messages || []).reduce(
    (sum, m) => sum + estimateMessageHistoryTokens(m) + MSG_OVERHEAD,
    0,
  );
}
