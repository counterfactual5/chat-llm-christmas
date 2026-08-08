/**
 * Local + cloud chat session persistence.
 * Pure async/sync helpers — hooks only own React state timing.
 *
 * Bound accounts use `LOCAL_CHATS_KEY` (+ owner anti-bleed). Guests use a
 * separate `LOCAL_GUEST_CHATS_KEY` so drafts survive refresh and stay isolated
 * from account histories (no cloud sync for guests).
 */

import type { ChatSession } from '@/lib/chat/types';
import {
  CHATS_OWNER_KEY,
  mergeSyncedSessions,
  normalizeRestoredSession,
  sessionsForCloudSync,
  sessionsWorthPersisting,
} from '@/lib/chat/session/store';

export const LOCAL_CHATS_KEY = 'llm_christmas_chats';
/** Device-local guest drafts — never shared with bound-account storage. */
export const LOCAL_GUEST_CHATS_KEY = 'llm_christmas_chats_guest';

function readLocalSessionsFrom(key: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(key);
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

function writeLocalSessionsTo(key: string, sessions: ChatSession[]): void {
  const persisted = sessionsWorthPersisting(sessions);
  if (persisted.length > 0) {
    localStorage.setItem(key, JSON.stringify(persisted));
  } else {
    localStorage.removeItem(key);
  }
}

export function readLocalSessions(): ChatSession[] {
  return readLocalSessionsFrom(LOCAL_CHATS_KEY);
}

export function writeLocalSessions(sessions: ChatSession[]): void {
  writeLocalSessionsTo(LOCAL_CHATS_KEY, sessions);
}

export function readGuestLocalSessions(): ChatSession[] {
  return readLocalSessionsFrom(LOCAL_GUEST_CHATS_KEY);
}

export function writeGuestLocalSessions(sessions: ChatSession[]): void {
  writeLocalSessionsTo(LOCAL_GUEST_CHATS_KEY, sessions);
}

/** Clears bound-account local cache only — guest drafts are left intact. */
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

/** Bound-account cloud GET budget — hang must not leave PUT gated forever. */
export const CLOUD_SESSIONS_FETCH_TIMEOUT_MS = 20_000;

/**
 * Fetch cloud sessions for merge. Throws on network/HTTP/timeout failure so
 * callers can keep PUT blocked (do not treat failure as empty cloud).
 * Empty `sessions` on a successful 2xx is a real empty list.
 */
export async function fetchCloudSessions(
  fetchImpl: typeof fetch = fetch,
): Promise<ChatSession[]> {
  const syncRes = await fetchImpl('/api/sync/sessions', {
    cache: 'no-store',
    signal: AbortSignal.timeout(CLOUD_SESSIONS_FETCH_TIMEOUT_MS),
  });
  if (!syncRes.ok) {
    throw new Error(`Cloud sync failed (HTTP ${syncRes.status})`);
  }
  const syncData = await syncRes.json();
  return Array.isArray(syncData?.sessions)
    ? (syncData.sessions as ChatSession[])
    : [];
}

export async function putCloudSessions(
  sessions: ChatSession[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const persisted = sessionsWorthPersisting(sessions);
  if (persisted.length === 0) return;
  const res = await fetchImpl('/api/sync/sessions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessions: sessionsForCloudSync(persisted) }),
  });
  if (!res.ok) {
    throw new Error(`Cloud sync failed (HTTP ${res.status})`);
  }
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
 * Build the initial session list from a localStorage key.
 * Bound accounts use `LOCAL_CHATS_KEY`; guests use `LOCAL_GUEST_CHATS_KEY`.
 * Cloud merge (bound only) is applied separately via `mergeSyncedSessions`.
 */
export function hydrateSessionsFromLocal(
  key: string = LOCAL_CHATS_KEY,
): HydrateSessionsResult {
  const nonEmpty = readLocalSessionsFrom(key);
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

/**
 * True when merge produced no object swaps (same session references in order).
 * Uses referential equality so an updatedAt-tie that prefers the other tab’s
 * copy is still treated as a real change.
 */
export function sameSessionRevision(
  a: ChatSession[],
  b: ChatSession[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
