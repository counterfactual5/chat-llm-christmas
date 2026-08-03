/**
 * Stream settle helpers: orphan reasoning, empty fallback, seeded cleanup.
 */

import type { ChatSession } from '@/lib/chat/types';
import { touchSession } from '@/lib/chat/session/mutations/shared';

/**
 * Decide what to do when the bubble body is still empty at settle time.
 * - promote: gateway put the whole answer in reasoning (no orphan </think>)
 * - thought_only: orphan </think> already moved draft into Thought — keep it there
 * - empty_error: nothing usable — show Retry fallback
 */
export function settleEmptyBodyAction(opts: {
  suppressedOrphanPromote: boolean;
  reasoning: string;
}): 'promote' | 'thought_only' | 'empty_error' {
  const hasReasoning = Boolean(String(opts.reasoning || '').trim());
  if (opts.suppressedOrphanPromote && hasReasoning) return 'thought_only';
  if (hasReasoning && !opts.suppressedOrphanPromote) return 'promote';
  return 'empty_error';
}

export function withPromotedOrphanReasoning(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  orphan: string,
): ChatSession[] {
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        return {
          ...m,
          content: orphan,
          reasoning: undefined,
          activity: (m.activity || []).filter((a) => a.kind !== 'reasoning'),
        };
      }),
    });
  });
}

export function withEmptyReplyFallback(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  fallback: string,
): ChatSession[] {
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return touchSession(s, {
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        return {
          ...m,
          content: fallback,
          incomplete: false,
          truncationReason: undefined,
        };
      }),
    });
  });
}

export function withSeededAssistantCleanup(
  sessions: ChatSession[],
  sessionId: string,
  assistantId: string,
  seededContent: string,
  seededReasoning: string | undefined,
): ChatSession[] {
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    return {
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m;
        const mergedReasoning = [m.reasoning, seededReasoning].filter(Boolean).join('\n\n');
        return {
          ...m,
          content: seededContent,
          reasoning: mergedReasoning || undefined,
        };
      }),
    };
  });
}

