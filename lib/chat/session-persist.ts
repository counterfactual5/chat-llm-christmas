/**
 * Local + cloud chat session persistence.
 * Pure async/sync helpers — hooks only own React state timing.
 */

import type { ChatSession } from '@/lib/chat/types';
import {
  CHATS_OWNER_KEY,
  mergeSyncedSessions,
  normalizeRestoredSession,
  sessionsForCloudSync,
  sessionsWorthPersisting,
} from '@/lib/chat/sessions';

const LOCAL_CHATS_KEY = 'llm_christmas_chats';

export function readLocalSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(LOCAL_CHATS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    return parsed
      .filter(
        (session) =>
          session.messages?.length > 0 ||
          (session.mcpIds && session.mcpIds.length > 0) ||
          (session.skillIds && session.skillIds.length > 0),
      )
      .map(normalizeRestoredSession);
  } catch {
    return [];
  }
}

export function writeLocalSessions(sessions: ChatSession[]): void {
  const persisted = sessionsWorthPersisting(sessions);
  if (persisted.length > 0) {
    localStorage.setItem(LOCAL_CHATS_KEY, JSON.stringify(persisted));
  } else {
    localStorage.removeItem(LOCAL_CHATS_KEY);
  }
}

export function clearLocalSessions(): void {
  try {
    localStorage.removeItem(LOCAL_CHATS_KEY);
    localStorage.removeItem(CHATS_OWNER_KEY);
  } catch {
    // ignore
  }
}

/**
 * If another account previously owned this browser cache, wipe chats so
 * histories never bleed across users.
 */
export function enforceChatsOwner(username: string | null): void {
  const ownerKey = username || 'account';
  try {
    const storedOwner = localStorage.getItem(CHATS_OWNER_KEY);
    if (storedOwner && storedOwner !== ownerKey) {
      localStorage.removeItem(LOCAL_CHATS_KEY);
    }
    localStorage.setItem(CHATS_OWNER_KEY, ownerKey);
  } catch {
    // ignore
  }
}

export async function fetchCloudSessions(
  fetchImpl: typeof fetch = fetch,
): Promise<ChatSession[]> {
  try {
    const syncRes = await fetchImpl('/api/sync/sessions', { cache: 'no-store' });
    if (!syncRes.ok) return [];
    const syncData = await syncRes.json();
    return Array.isArray(syncData?.sessions)
      ? (syncData.sessions as ChatSession[])
      : [];
  } catch {
    return [];
  }
}

export async function putCloudSessions(
  sessions: ChatSession[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const persisted = sessionsWorthPersisting(sessions);
  if (persisted.length === 0) return;
  await fetchImpl('/api/sync/sessions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessions: sessionsForCloudSync(persisted) }),
  });
}

export type HydrateSessionsResult = {
  /** Sessions to show after local restore (+ optional blank draft). */
  sessions: ChatSession[] | null;
  /** Active id when a draft was prepended; null if caller should createNewSession. */
  activeSessionId: string | null;
  /** True when caller should create a blank draft (no restored threads). */
  needsDraft: boolean;
};

/**
 * Build the initial session list for a bound account from localStorage.
 * Cloud merge is applied separately via `mergeSyncedSessions`.
 */
export function hydrateSessionsFromLocal(): HydrateSessionsResult {
  const nonEmpty = readLocalSessions();
  if (nonEmpty.length === 0) {
    return { sessions: null, activeSessionId: null, needsDraft: true };
  }
  const draft: ChatSession = {
    id: crypto.randomUUID(),
    title: 'New Conversation',
    messages: [],
    updatedAt: Date.now(),
  };
  return {
    sessions: [draft, ...nonEmpty],
    activeSessionId: draft.id,
    needsDraft: false,
  };
}

export function mergeLocalWithCloud(
  local: ChatSession[],
  cloud: ChatSession[],
): ChatSession[] {
  if (!cloud.length) return local;
  return mergeSyncedSessions(local, cloud);
}
