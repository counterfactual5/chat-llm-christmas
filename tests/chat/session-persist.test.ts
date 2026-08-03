import { describe, expect, it, vi } from 'vitest';
import {
  putCloudSessions,
  mergeLocalWithCloud,
  sameSessionRevision,
} from '@/lib/chat/session/persist';
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
});
