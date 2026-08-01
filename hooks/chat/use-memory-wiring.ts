'use client';

/**
 * Memory manager modal + reply-settled extraction wiring for the chat shell.
 * CRUD lives in use-memories.ts; triggers/scheduler live in lib/memories/.
 */

import { useCallback, useRef, useState } from 'react';
import type { ChatSession } from '@/lib/chat/types';
import { scheduleMemoryExtraction } from '@/lib/memories/scheduler';
import { useChatMemories } from '@/hooks/chat/use-memories';

type SessionUpdater = (updater: (prev: ChatSession[]) => ChatSession[]) => void;

export function useMemoryWiring(opts: {
  setSessions: SessionUpdater;
  getSession: (sessionId: string) => ChatSession | undefined;
  selectedModel: string;
  isAccountBound: boolean;
}) {
  const { setSessions, getSession, selectedModel, isAccountBound } = opts;

  const selectedModelRef = useRef(selectedModel);
  const isAccountBoundRef = useRef(isAccountBound);
  const getSessionRef = useRef(getSession);
  selectedModelRef.current = selectedModel;
  isAccountBoundRef.current = isAccountBound;
  getSessionRef.current = getSession;

  const [memoriesManagerOpen, setMemoriesManagerOpen] = useState(false);

  const {
    memories,
    setMemories,
    loading: memoriesLoading,
    error: memoriesError,
    saving: memoriesSaving,
    fetchMemories,
    mergeSaved: mergeSavedMemories,
    updateMemory,
    deleteMemory,
    exportMarkdown,
    importMarkdown,
    enabledMemoriesPayload,
  } = useChatMemories();

  const openMemoriesModal = useCallback(() => setMemoriesManagerOpen(true), []);
  const closeMemoriesModal = useCallback(() => setMemoriesManagerOpen(false), []);

  const setMemoryExtractCursor = useCallback(
    (sessionId: string, messageId: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? { ...session, memoryExtractCursor: messageId, updatedAt: Date.now() }
            : session,
        ),
      );
    },
    [setSessions],
  );

  const memoriesPayload = useCallback(
    () => enabledMemoriesPayload(),
    [enabledMemoriesPayload],
  );

  const onReplySettled = useCallback(
    ({
      sessionId,
      requestReview,
      incomplete,
    }: {
      sessionId: string;
      requestReview?: boolean;
      incomplete?: boolean;
    }) => {
      scheduleMemoryExtraction(
        {
          getSession: (id) => getSessionRef.current(id),
          getSelectedModel: () => selectedModelRef.current,
          getExistingMemories: () => enabledMemoriesPayload(),
          isAccountBound: () => Boolean(isAccountBoundRef.current),
          setMemoryExtractCursor,
          onMemoriesSaved: mergeSavedMemories,
        },
        sessionId,
        { requestReview, incomplete },
      );
    },
    [enabledMemoriesPayload, mergeSavedMemories, setMemoryExtractCursor],
  );

  return {
    memories,
    setMemories,
    memoriesLoading,
    memoriesError,
    memoriesSaving,
    fetchMemories,
    updateMemory,
    deleteMemory,
    exportMarkdown,
    importMarkdown,
    memoriesPayload,
    memoriesManagerOpen,
    openMemoriesModal,
    closeMemoriesModal,
    onReplySettled,
  };
}
