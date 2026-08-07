'use client';

/**
 * Chat list hydrate + localStorage + debounced cloud sync.
 * Independent of account OAuth UI and send/stream.
 *
 * Guests persist to a separate localStorage key (no cloud). Writes are gated by
 * `persistMode` so a mid-session login/logout cannot scribble guest drafts into
 * the account cache (or the reverse) before the matching hydrate finishes.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ChatSession } from '@/lib/chat/types';
import {
  LOCAL_CHATS_KEY,
  LOCAL_GUEST_CHATS_KEY,
  fetchCloudSessions,
  hydrateSessionsFromLocal,
  mergeLocalWithCloud,
  putCloudSessions,
  readGuestLocalSessions,
  readLocalSessions,
  sameSessionRevision,
  writeGuestLocalSessions,
  writeLocalSessions,
  enforceChatsOwner,
} from '@/lib/chat/session/persist';

type PersistMode = 'guest' | 'bound' | null;

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
  /** False until bound-account cloud GET settles — gates PUT so we don't upload pre-merge local. */
  const [cloudHydrateSettled, setCloudHydrateSettled] = useState(false);
  /** Bumps after each cloud hydrate settle so remount cleanup can re-run on merged sessions. */
  const [cloudHydrateEpoch, setCloudHydrateEpoch] = useState(0);
  /**
   * Which localStorage bucket is safe to write. `null` while switching auth
   * modes so we never flush the wrong in-memory list into the other bucket.
   */
  const [persistMode, setPersistMode] = useState<PersistMode>(null);
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
    setPersistMode(null);
    setCloudHydrateSettled(false);
    enforceChatsOwner(username);
    const local = hydrateSessionsFromLocal(LOCAL_CHATS_KEY);
    if (local.needsDraft || !local.sessions) {
      createNewSessionRef.current();
    } else {
      setSessions(local.sessions);
      if (local.activeSessionId) setActiveSessionId(local.activeSessionId);
    }
    // Local-first: do not block UI / sibling boot fetches on cloud sync.
    setChatsHydrated(true);
    setPersistMode('bound');

    try {
      const cloud = await fetchCloudSessions();
      if (cloud.length > 0) {
        setSessions((prev) => mergeLocalWithCloud(prev, cloud));
      }
    } catch {
      // Local list already painted; banner path covers later PUTs.
    } finally {
      setCloudHydrateSettled(true);
      setCloudHydrateEpoch((n) => n + 1);
    }
  };

  /** Restore guest drafts from the guest-only localStorage key (no cloud). */
  const hydrateGuest = () => {
    setPersistMode(null);
    const local = hydrateSessionsFromLocal(LOCAL_GUEST_CHATS_KEY);
    if (local.needsDraft || !local.sessions) {
      createNewSessionRef.current();
    } else {
      setSessions(local.sessions);
      if (local.activeSessionId) setActiveSessionId(local.activeSessionId);
    }
    setChatsHydrated(true);
    setCloudHydrateSettled(true);
    setCloudHydrateEpoch((n) => n + 1);
    setPersistMode('guest');
  };

  // Persist locally once hydrated into the matching bucket.
  useEffect(() => {
    if (!chatsHydrated || !persistMode) return;
    if (persistMode === 'bound' && !isAccountBound) return;
    if (persistMode === 'guest' && isAccountBound) return;

    writingLocalRef.current = true;
    try {
      if (persistMode === 'bound') writeLocalSessions(sessions);
      else writeGuestLocalSessions(sessions);
    } finally {
      // storage events only fire in *other* tabs; clear on next tick anyway.
      queueMicrotask(() => {
        writingLocalRef.current = false;
      });
    }
  }, [sessions, isAccountBound, chatsHydrated, persistMode]);

  // Debounced cloud upload — wait until initial cloud GET has settled.
  useEffect(() => {
    if (!isAccountBound || persistMode !== 'bound' || !chatsHydrated || !cloudHydrateSettled) {
      return;
    }
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
  }, [sessions, isAccountBound, persistMode, chatsHydrated, cloudHydrateSettled]);

  // Other tabs share the same localStorage key — LWW-merge when they write.
  useEffect(() => {
    if (!chatsHydrated || !persistMode) return;
    if (persistMode === 'bound' && !isAccountBound) return;
    if (persistMode === 'guest' && isAccountBound) return;
    if (typeof window === 'undefined') return;

    const watchedKey =
      persistMode === 'bound' ? LOCAL_CHATS_KEY : LOCAL_GUEST_CHATS_KEY;

    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== watchedKey) return;
      if (writingLocalRef.current) return;
      const remote =
        persistMode === 'bound' ? readLocalSessions() : readGuestLocalSessions();
      setSessions((prev) => {
        const merged = mergeLocalWithCloud(prev, remote);
        if (sameSessionRevision(prev, merged)) return prev;
        queueMicrotask(() => onCrossTabMergeRef.current?.());
        return merged;
      });
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [isAccountBound, chatsHydrated, persistMode, setSessions]);

  return {
    chatsHydrated,
    setChatsHydrated,
    cloudHydrateEpoch,
    hydrateBoundAccount,
    hydrateGuest,
  };
}
