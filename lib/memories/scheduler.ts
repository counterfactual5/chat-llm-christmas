/**
 * Client-side memory extraction scheduler with dynamic triggers.
 */

import {
  MEMORY_IDLE_MS,
  decideMemoryExtraction,
  messagesAfterCursor,
} from '@/lib/memories/trigger';
import type { MemoryItem } from '@/lib/memories/types';

type SessionLike = {
  id: string;
  messages: Array<{ id: string; role: string; content: string }>;
  memoryExtractCursor?: string;
};

type SchedulerDeps = {
  getSession: (sessionId: string) => SessionLike | undefined;
  getSelectedModel: () => string;
  getExistingMemories: () => Array<Pick<MemoryItem, 'id' | 'kind' | 'content'>>;
  isAccountBound: () => boolean;
  setMemoryExtractCursor: (sessionId: string, messageId: string) => void;
  onMemoriesSaved: (saved: MemoryItem[]) => void;
};

type SessionState = {
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  lastScheduledAt: number;
};

const states = new Map<string, SessionState>();

function getState(sessionId: string): SessionState {
  let state = states.get(sessionId);
  if (!state) {
    state = { timer: null, inFlight: false, lastScheduledAt: 0 };
    states.set(sessionId, state);
  }
  return state;
}

function clearTimer(sessionId: string) {
  const state = states.get(sessionId);
  if (!state?.timer) return;
  clearTimeout(state.timer);
  state.timer = null;
}

async function runExtract(
  deps: SchedulerDeps,
  sessionId: string,
  pending: SessionLike['messages'],
) {
  const state = getState(sessionId);
  if (state.inFlight) return;
  if (!deps.isAccountBound()) return;
  const model = deps.getSelectedModel();
  if (!model || !pending.length) return;

  state.inFlight = true;
  clearTimer(sessionId);
  try {
    const response = await fetch('/api/memories/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        conversationId: sessionId,
        messages: pending.map((m) => ({
          id: m.id,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        existingMemories: deps.getExistingMemories().slice(0, 20),
      }),
    });
    const json = await response.json().catch(() => ({}));
    // Advance cursor even when nothing was saved — avoid reprocessing the same turns.
    const lastId = pending[pending.length - 1]?.id;
    if (lastId) deps.setMemoryExtractCursor(sessionId, lastId);
    if (response.ok && Array.isArray(json?.data?.saved) && json.data.saved.length) {
      deps.onMemoriesSaved(json.data.saved as MemoryItem[]);
    }
  } catch (error) {
    console.warn('[memories] extract failed:', error);
  } finally {
    state.inFlight = false;
  }
}

export function cancelMemoryExtraction(sessionId: string) {
  clearTimer(sessionId);
}

export function scheduleMemoryExtraction(
  deps: SchedulerDeps,
  sessionId: string,
  opts?: { requestReview?: boolean; incomplete?: boolean },
) {
  if (opts?.requestReview || opts?.incomplete) return;
  if (!deps.isAccountBound()) return;

  const session = deps.getSession(sessionId);
  if (!session) return;

  const pending = messagesAfterCursor(
    session.messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
    session.memoryExtractCursor,
  ).filter((m) => String(m.content || '').trim());

  const decision = decideMemoryExtraction({
    pendingMessages: pending,
    idleMs: 0,
  });

  clearTimer(sessionId);
  const state = getState(sessionId);

  if (decision.shouldExtract && decision.reason === 'cue') {
    void runExtract(deps, sessionId, pending);
    return;
  }

  if (
    decision.shouldExtract &&
    (decision.reason === 'turn_limit' || decision.reason === 'size_limit')
  ) {
    void runExtract(deps, sessionId, pending);
    return;
  }

  if (!pending.length) return;

  state.lastScheduledAt = Date.now();
  state.timer = setTimeout(() => {
    const latest = deps.getSession(sessionId);
    if (!latest) return;
    const nextPending = messagesAfterCursor(
      latest.messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
      latest.memoryExtractCursor,
    ).filter((m) => String(m.content || '').trim());
    const idleDecision = decideMemoryExtraction({
      pendingMessages: nextPending,
      idleMs: MEMORY_IDLE_MS,
    });
    if (idleDecision.shouldExtract) {
      void runExtract(deps, sessionId, nextPending);
    }
  }, MEMORY_IDLE_MS);
}
