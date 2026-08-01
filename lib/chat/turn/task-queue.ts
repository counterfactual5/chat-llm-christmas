/**
 * Per-session outgoing message queue — pure helpers, no React.
 * The chat hook owns state; this module decides drain/order/pause transitions.
 */

import type { Message } from '@/lib/chat/types';

export type QueuedTask = {
  id: string;
  sessionId: string;
  content: string;
  baseMessages?: Message[];
  enqueueTime: number;
};

/** First waiting task per idle, unpaused session (one drain slot each). */
export function selectTasksToDrain(
  queue: QueuedTask[],
  loadingBySession: Record<string, boolean>,
  pausedBySession: Record<string, boolean>,
): QueuedTask[] {
  const toStart: QueuedTask[] = [];
  const seen = new Set<string>();
  for (const task of queue) {
    if (seen.has(task.sessionId)) continue;
    if (loadingBySession[task.sessionId] || pausedBySession[task.sessionId]) continue;
    seen.add(task.sessionId);
    toStart.push(task);
  }
  return toStart;
}

export function removeTasksById(queue: QueuedTask[], ids: Iterable<string>): QueuedTask[] {
  const drop = ids instanceof Set ? ids : new Set(ids);
  return queue.filter((task) => !drop.has(task.id));
}

export function removeTaskById(queue: QueuedTask[], id: string): QueuedTask[] {
  return queue.filter((task) => task.id !== id);
}

export function removeTasksForSession(queue: QueuedTask[], sessionId: string): QueuedTask[] {
  return queue.filter((task) => task.sessionId !== sessionId);
}

export function tasksForSession(queue: QueuedTask[], sessionId: string): QueuedTask[] {
  return queue.filter((task) => task.sessionId === sessionId);
}

export function clearPauseForSession(
  paused: Record<string, boolean>,
  sessionId: string,
): Record<string, boolean> {
  if (!paused[sessionId]) return paused;
  const next = { ...paused };
  delete next[sessionId];
  return next;
}

export function pauseSession(
  paused: Record<string, boolean>,
  sessionId: string,
): Record<string, boolean> {
  return { ...paused, [sessionId]: true };
}

/**
 * After removing a task: if that session has no remaining queued items,
 * clear its pause flag so a later enqueue can drain normally.
 */
export function afterRemoveTask(
  queueAfterRemove: QueuedTask[],
  removed: QueuedTask | undefined,
  paused: Record<string, boolean>,
): Record<string, boolean> {
  if (!removed) return paused;
  if (queueAfterRemove.some((task) => task.sessionId === removed.sessionId)) return paused;
  return clearPauseForSession(paused, removed.sessionId);
}

export function requeueFailedTask(task: QueuedTask): QueuedTask {
  return { ...task, id: crypto.randomUUID(), enqueueTime: Date.now() };
}
