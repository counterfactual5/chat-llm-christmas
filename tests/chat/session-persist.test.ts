import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUD_SESSIONS_FETCH_TIMEOUT_MS,
  LOCAL_CHATS_KEY,
  LOCAL_GUEST_CHATS_KEY,
  clearLocalSessions,
  fetchCloudSessions,
  hydrateSessionsFromLocal,
  putCloudSessions,
  mergeLocalWithCloud,
  readGuestLocalSessions,
  readLocalSessions,
  sameSessionRevision,
  writeGuestLocalSessions,
  writeLocalSessions,
} from '@/lib/chat/session/persist';
import { CHATS_OWNER_KEY } from '@/lib/chat/session/store';
import type { ChatSession } from '@/lib/chat/types';

function session(id: string, updatedAt: number): ChatSession {
  return {
    id,
    title: id,
    updatedAt,
    messages: [{ id: `${id}-m`, role: 'user', content: 'hi', timestamp: updatedAt }],
  };
}

describe('session persist helpers', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    const localStorageMock = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
    };
    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sameSessionRevision uses referential equality (catches updatedAt ties)', () => {
    const shared = session('a', 1);
    const a = [shared, session('b', 2)];
    expect(sameSessionRevision(a, [shared, a[1]!])).toBe(true);
    // Same id/updatedAt but a different object — other tab won an LWW tie.
    expect(sameSessionRevision(a, [session('a', 1), a[1]!])).toBe(false);
    expect(sameSessionRevision(a, [shared])).toBe(false);
  });

  it('mergeLocalWithCloud applies the remote copy on an updatedAt tie', () => {
    const local = session('shared', 10);
    local.messages = [{ id: 'local-m', role: 'user', content: 'local', timestamp: 10 }];
    const remote = session('shared', 10);
    remote.messages = [{ id: 'remote-m', role: 'user', content: 'remote', timestamp: 10 }];
    const merged = mergeLocalWithCloud([local], [remote]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).not.toBe(local);
    expect(merged[0]?.messages[0]?.content).toBe('remote');
    expect(sameSessionRevision([local], merged)).toBe(false);
  });

  it('putCloudSessions throws when the sync API returns an error status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
    await expect(putCloudSessions([session('s1', 1)], fetchImpl)).rejects.toThrow(
      /Cloud sync failed \(HTTP 503\)/,
    );
  });

  it('putCloudSessions no-ops for empty session lists', async () => {
    const fetchImpl = vi.fn();
    await putCloudSessions([], fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetchCloudSessions throws on HTTP error (do not treat as empty cloud)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
    await expect(fetchCloudSessions(fetchImpl)).rejects.toThrow(
      /Cloud sync failed \(HTTP 503\)/,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/sync/sessions',
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('fetchCloudSessions throws on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchCloudSessions(fetchImpl)).rejects.toThrow(/Failed to fetch/);
  });

  it('fetchCloudSessions returns empty array on successful empty payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sessions: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(fetchCloudSessions(fetchImpl)).resolves.toEqual([]);
  });

  it('fetchCloudSessions uses a hard timeout budget', () => {
    expect(CLOUD_SESSIONS_FETCH_TIMEOUT_MS).toBe(20_000);
  });

  it('keeps guest drafts in a separate key from bound-account chats', () => {
    writeLocalSessions([session('account', 1)]);
    writeGuestLocalSessions([session('guest', 2)]);
    expect(readLocalSessions().map((s) => s.id)).toEqual(['account']);
    expect(readGuestLocalSessions().map((s) => s.id)).toEqual(['guest']);
    expect(localStorage.getItem(LOCAL_CHATS_KEY)).toBeTruthy();
    expect(localStorage.getItem(LOCAL_GUEST_CHATS_KEY)).toBeTruthy();
  });

  it('clearLocalSessions leaves guest drafts intact', () => {
    writeLocalSessions([session('account', 1)]);
    writeGuestLocalSessions([session('guest', 2)]);
    localStorage.setItem(CHATS_OWNER_KEY, 'alice');
    clearLocalSessions();
    expect(readLocalSessions()).toEqual([]);
    expect(localStorage.getItem(CHATS_OWNER_KEY)).toBeNull();
    expect(readGuestLocalSessions().map((s) => s.id)).toEqual(['guest']);
  });

  it('hydrateSessionsFromLocal restores guest drafts with a blank draft prepended', () => {
    writeGuestLocalSessions([session('guest', 2)]);
    const result = hydrateSessionsFromLocal(LOCAL_GUEST_CHATS_KEY);
    expect(result.needsDraft).toBe(false);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions?.[0]?.messages).toEqual([]);
    expect(result.sessions?.[1]?.id).toBe('guest');
    expect(result.activeSessionId).toBe(result.sessions?.[0]?.id);
  });
});
