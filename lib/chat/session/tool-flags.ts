/**
 * Per-chat Tools / MCP / Skills / auto-review / model flags.
 * Session object is SSOT — patch only the target id; never copy UI state across chats.
 */

import type { ChatSession } from '@/lib/chat/types';

export type StringListUpdater = string[] | ((prev: string[]) => string[]);

function resolveList(prev: string[] | undefined, updater: StringListUpdater): string[] {
  const base = prev || [];
  return typeof updater === 'function' ? updater(base) : updater;
}

function sameStringList(a: string[] | undefined, b: string[]): boolean {
  const left = a || [];
  if (left.length !== b.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== b[i]) return false;
  }
  return true;
}

/** Patch mcpIds on one session only. No-op (same reference) when unchanged. */
export function patchSessionMcpIds(
  sessions: ChatSession[],
  sessionId: string,
  updater: StringListUpdater,
): ChatSession[] {
  if (!sessionId) return sessions;
  let changed = false;
  const next = sessions.map((s) => {
    if (s.id !== sessionId) return s;
    const mcpIds = resolveList(s.mcpIds, updater);
    if (sameStringList(s.mcpIds, mcpIds)) return s;
    changed = true;
    return { ...s, mcpIds, updatedAt: Date.now() };
  });
  return changed ? next : sessions;
}

/** Patch skillIds on one session only. */
export function patchSessionSkillIds(
  sessions: ChatSession[],
  sessionId: string,
  updater: StringListUpdater,
): ChatSession[] {
  if (!sessionId) return sessions;
  let changed = false;
  const next = sessions.map((s) => {
    if (s.id !== sessionId) return s;
    const skillIds = resolveList(s.skillIds, updater);
    if (sameStringList(s.skillIds, skillIds)) return s;
    changed = true;
    return { ...s, skillIds, updatedAt: Date.now() };
  });
  return changed ? next : sessions;
}

/** Patch autoReview on one session only. */
export function patchSessionAutoReview(
  sessions: ChatSession[],
  sessionId: string,
  autoReview: boolean,
): ChatSession[] {
  if (!sessionId) return sessions;
  let changed = false;
  const next = sessions.map((s) => {
    if (s.id !== sessionId) return s;
    if (s.autoReview === autoReview) return s;
    changed = true;
    return { ...s, autoReview, updatedAt: Date.now() };
  });
  return changed ? next : sessions;
}

/** Patch chat-completion model on one session only. */
export function patchSessionModel(
  sessions: ChatSession[],
  sessionId: string,
  model: string,
  opts?: { touchUpdatedAt?: boolean },
): ChatSession[] {
  if (!sessionId) return sessions;
  const nextModel = String(model || '').trim();
  if (!nextModel) return sessions;
  const touchUpdatedAt = opts?.touchUpdatedAt !== false;
  let changed = false;
  const next = sessions.map((s) => {
    if (s.id !== sessionId) return s;
    if (s.model === nextModel) return s;
    changed = true;
    return touchUpdatedAt
      ? { ...s, model: nextModel, updatedAt: Date.now() }
      : { ...s, model: nextModel };
  });
  return changed ? next : sessions;
}

/**
 * Simulate: set tools on A → switch to B → change B → switch back to A.
 * Pure reducer used by tests (and documents the isolation contract).
 */
export function applySessionToolFlagSequence(
  sessions: ChatSession[],
  steps: Array<
    | { type: 'mcp'; sessionId: string; updater: StringListUpdater }
    | { type: 'autoReview'; sessionId: string; value: boolean }
    | { type: 'model'; sessionId: string; model: string }
  >,
): ChatSession[] {
  return steps.reduce((acc, step) => {
    if (step.type === 'mcp') {
      return patchSessionMcpIds(acc, step.sessionId, step.updater);
    }
    if (step.type === 'model') {
      return patchSessionModel(acc, step.sessionId, step.model);
    }
    return patchSessionAutoReview(acc, step.sessionId, step.value);
  }, sessions);
}
