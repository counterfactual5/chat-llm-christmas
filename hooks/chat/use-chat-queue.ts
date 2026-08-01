import { useMemo, useState } from 'react';
import {
  afterRemoveTask,
  clearPauseForSession,
  removeTaskById,
  removeTasksForSession,
  tasksForSession,
  type QueuedTask,
} from '@/lib/chat/turn/task-queue';

/**
 * Owns the client-side per-session task queue state.
 *
 * Draining remains in useChatLogic because it starts a chat turn; this hook
 * deliberately contains only queue state and side-effect-free mutations.
 */
export function useChatQueue(activeSessionId: string) {
  const [messageQueue, setMessageQueue] = useState<QueuedTask[]>([]);
  const [queuePausedBySession, setQueuePausedBySession] = useState<Record<string, boolean>>({});

  const activeQueue = useMemo(
    () => tasksForSession(messageQueue, activeSessionId),
    [messageQueue, activeSessionId],
  );
  const queuePaused = Boolean(queuePausedBySession[activeSessionId]);

  const cancelQueuedMessage = (id: string) => {
    setMessageQueue((prev) => {
      const removed = prev.find((task) => task.id === id);
      const next = removeTaskById(prev, id);
      setQueuePausedBySession((paused) => afterRemoveTask(next, removed, paused));
      return next;
    });
  };

  const clearQueue = () => {
    setMessageQueue((prev) => removeTasksForSession(prev, activeSessionId));
    setQueuePausedBySession((prev) => clearPauseForSession(prev, activeSessionId));
  };

  const resumeQueue = () => {
    setQueuePausedBySession((prev) => clearPauseForSession(prev, activeSessionId));
  };

  return {
    messageQueue,
    setMessageQueue,
    queuePausedBySession,
    setQueuePausedBySession,
    activeQueue,
    queuePaused,
    cancelQueuedMessage,
    clearQueue,
    resumeQueue,
  };
}
