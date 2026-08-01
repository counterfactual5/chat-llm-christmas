'use client';

/**
 * Chat list hydrate + localStorage + debounced cloud sync.
 * Independent of account OAuth UI and send/stream.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ChatSession } from '@/lib/chat/types';
import {
  fetchCloudSessions,
  hydrateSessionsFromLocal,
  mergeLocalWithCloud,
  putCloudSessions,
  writeLocalSessions,
  enforceChatsOwner,
} from '@/lib/chat/session-persist';

export function useChatSessionPersist(opts: {
  sessions: ChatSession[];
  setSessions: Dispatch<SetStateAction<ChatSession[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  createNewSession: () => void;
  isAccountBound: boolean;
}) {
  const { sessions, setSessions, setActiveSessionId, createNewSession, isAccountBound } = opts;
  const [chatsHydrated, setChatsHydrated] = useState(false);
  const cloudSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createNewSessionRef = useRef(createNewSession);
  createNewSessionRef.current = createNewSession;

  /**
   * Restore local chats (and merge cloud) for a bound account.
   * Caller owns account refresh + post-hydrate fetches.
   */
  const hydrateBoundAccount = async (username: string | null) => {
    enforceChatsOwner(username);
    const local = hydrateSessionsFromLocal();
    if (local.needsDraft || !local.sessions) {
      createNewSessionRef.current();
    } else {
      setSessions(local.sessions);
      if (local.activeSessionId) setActiveSessionId(local.activeSessionId);
    }

    const cloud = await fetchCloudSessions();
    if (cloud.length > 0) {
      setSessions((prev) => mergeLocalWithCloud(prev, cloud));
    }
    setChatsHydrated(true);
  };

  const hydrateGuest = () => {
    createNewSessionRef.current();
    setChatsHydrated(true);
  };

  // Persist locally once hydrated.
  useEffect(() => {
    if (!isAccountBound || !chatsHydrated) return;
    writeLocalSessions(sessions);
  }, [sessions, isAccountBound, chatsHydrated]);

  // Debounced cloud upload.
  useEffect(() => {
    if (!isAccountBound || !chatsHydrated) return;
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    cloudSyncTimerRef.current = setTimeout(() => {
      void putCloudSessions(sessions).catch(() => {
        // Offline / portal down: localStorage remains the fallback.
      });
    }, 1500);
    return () => {
      if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    };
  }, [sessions, isAccountBound, chatsHydrated]);

  return {
    chatsHydrated,
    setChatsHydrated,
    hydrateBoundAccount,
    hydrateGuest,
  };
}
