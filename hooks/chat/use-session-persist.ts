'use client';

/**
 * Chat list hydrate + localStorage + debounced cloud sync.
 * Independent of account OAuth UI and send/stream.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ChatSession } from '@/lib/chat/types';
import {
  LOCAL_CHATS_KEY,
  fetchCloudSessions,
  hydrateSessionsFromLocal,
  mergeLocalWithCloud,
  putCloudSessions,
  readLocalSessions,
  sameSessionRevision,
  writeLocalSessions,
  enforceChatsOwner,
} from '@/lib/chat/session/persist';

export function useChatSessionPersist(opts: {
  sessions: ChatSession[];
  setSessions: Dispatch<SetStateAction<ChatSession[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  createNewSession: () => void;
  isAccountBound: boolean;
  /** Cloud PUT failed — localStorage still holds chats. */
  onCloudSyncError?: (message: string) => void;
  /** Another tab wrote chats; local state was LWW-merged. */
  onCrossTabMerge?: () => void;
}) {
  const {
    sessions,
    setSessions,
    setActiveSessionId,
    createNewSession,
    isAccountBound,
    onCloudSyncError,
    onCrossTabMerge,
  } = opts;
  const [chatsHydrated, setChatsHydrated] = useState(false);
  const cloudSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createNewSessionRef = useRef(createNewSession);
  createNewSessionRef.current = createNewSession;
  const onCloudSyncErrorRef = useRef(onCloudSyncError);
  onCloudSyncErrorRef.current = onCloudSyncError;
  const onCrossTabMergeRef = useRef(onCrossTabMerge);
  onCrossTabMergeRef.current = onCrossTabMerge;
  /** Skip echoing our own local write back through a no-op merge path. */
  const writingLocalRef = useRef(false);

  /**
   * Restore local chats for a bound account, mark hydrated, then merge cloud.
   * Resolves after cloud GET (callers may run models in parallel with this promise).
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
    // Local-first: do not block UI / sibling boot fetches on cloud sync.
    setChatsHydrated(true);

    try {
      const cloud = await fetchCloudSessions();
      if (cloud.length > 0) {
        setSessions((prev) => mergeLocalWithCloud(prev, cloud));
      }
    } catch {
      // Local list already painted; banner path covers later PUTs.
    }
  };

  const hydrateGuest = () => {
    createNewSessionRef.current();
    setChatsHydrated(true);
  };

  // Persist locally once hydrated.
  useEffect(() => {
    if (!isAccountBound || !chatsHydrated) return;
    writingLocalRef.current = true;
    try {
      writeLocalSessions(sessions);
    } finally {
      // storage events only fire in *other* tabs; clear on next tick anyway.
      queueMicrotask(() => {
        writingLocalRef.current = false;
      });
    }
  }, [sessions, isAccountBound, chatsHydrated]);

  // Debounced cloud upload.
  useEffect(() => {
    if (!isAccountBound || !chatsHydrated) return;
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    cloudSyncTimerRef.current = setTimeout(() => {
      void putCloudSessions(sessions).catch((err: unknown) => {
        const detail =
          err instanceof Error && err.message
            ? err.message
            : 'Cloud sync failed';
        onCloudSyncErrorRef.current?.(
          `${detail} — chats stay on this device until sync works again.`,
        );
      });
    }, 1500);
    return () => {
      if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    };
  }, [sessions, isAccountBound, chatsHydrated]);

  // Other tabs share the same localStorage key — LWW-merge when they write.
  useEffect(() => {
    if (!isAccountBound || !chatsHydrated) return;
    if (typeof window === 'undefined') return;

    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== LOCAL_CHATS_KEY) return;
      if (writingLocalRef.current) return;
      const remote = readLocalSessions();
      setSessions((prev) => {
        const merged = mergeLocalWithCloud(prev, remote);
        if (sameSessionRevision(prev, merged)) return prev;
        queueMicrotask(() => onCrossTabMergeRef.current?.());
        return merged;
      });
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [isAccountBound, chatsHydrated, setSessions]);

  return {
    chatsHydrated,
    setChatsHydrated,
    hydrateBoundAccount,
    hydrateGuest,
  };
}
