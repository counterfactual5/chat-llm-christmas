import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_EXPORT_VERSION,
  MEMORIES_EXPORT_PAGE_LIMIT,
  accountExportFilename,
  accountExportJson,
  buildAccountDataExport,
  cloneSessionsForExport,
  fetchMemoriesForExport,
} from '@/lib/chat/session/export-all';
import type { ChatSession } from '@/lib/chat/types';
import type { MemoryItem } from '@/lib/memories/types';

function session(id: string, imageUrl?: string): ChatSession {
  return {
    id,
    title: `Chat ${id}`,
    updatedAt: 1,
    messages: [
      {
        id: `${id}-u`,
        role: 'user',
        content: 'hi',
        timestamp: 1,
        ...(imageUrl
          ? { images: [{ id: `${id}-img`, url: imageUrl, name: 'big.png' }] }
          : {}),
      },
      { id: `${id}-a`, role: 'assistant', content: 'hello', timestamp: 2 },
    ],
  };
}

function memory(id: string): MemoryItem {
  return {
    id,
    kind: 'preference',
    content: 'Prefer Chinese',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('account data export', () => {
  it('packs full sessions, memories, and MEMORY.md without cloud-sync scrub', () => {
    const bigDataUrl = `data:image/png;base64,${'A'.repeat(120 * 1024)}`;
    const exportedAt = new Date('2026-08-09T04:00:00.000Z');
    const payload = buildAccountDataExport({
      sessions: [session('s1', bigDataUrl)],
      memories: [memory('m1')],
      scope: 'account',
      sessionsSource: 'local+cloud',
      memoriesComplete: true,
      exportedAt,
    });
    expect(payload.version).toBe(ACCOUNT_EXPORT_VERSION);
    expect(payload.exportedAt).toBe('2026-08-09T04:00:00.000Z');
    expect(payload.scope).toBe('account');
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0]?.messages[0]?.images?.[0]?.url).toBe(bigDataUrl);
    expect(payload.memories).toEqual([memory('m1')]);
    expect(payload.memoryMarkdown).toContain('Prefer Chinese');
    expect(payload.completeness.memoriesComplete).toBe(true);
  });

  it('guest export omits MEMORY.md and keeps empty memories', () => {
    const payload = buildAccountDataExport({
      sessions: [session('g1')],
      memories: [],
      scope: 'guest',
      sessionsSource: 'local',
      memoriesComplete: true,
      exportedAt: new Date('2026-08-09T04:00:00.000Z'),
    });
    expect(payload.scope).toBe('guest');
    expect(payload.memories).toEqual([]);
    expect(payload.memoryMarkdown).toBe('');
    expect(payload.completeness.sessionsSource).toBe('local');
  });

  it('records truncation warnings when memoriesComplete is false', () => {
    const payload = buildAccountDataExport({
      sessions: [],
      memories: [memory('m1')],
      scope: 'account',
      sessionsSource: 'local+cloud',
      memoriesComplete: false,
      exportedAt: new Date('2026-08-09T04:00:00.000Z'),
    });
    expect(payload.completeness.memoriesComplete).toBe(false);
    expect(payload.completeness.warnings.some((w) => /incomplete|truncated/i.test(w))).toBe(
      true,
    );
  });

  it('cloneSessionsForExport deep-clones without mutating source', () => {
    const src = [session('s1')];
    const cloned = cloneSessionsForExport(src);
    expect(cloned).toEqual(src);
    expect(cloned).not.toBe(src);
    expect(cloned[0]).not.toBe(src[0]);
    cloned[0]!.title = 'mutated';
    expect(src[0]!.title).toBe('Chat s1');
  });

  it('names the download file with a stable ISO stamp', () => {
    expect(accountExportFilename(new Date('2026-08-09T04:05:06.000Z'))).toBe(
      'llm-christmas-export-2026-08-09-04-05-06.json',
    );
  });

  it('serializes pretty JSON with a trailing newline', () => {
    const payload = buildAccountDataExport({
      sessions: [],
      memories: [],
      scope: 'guest',
      sessionsSource: 'local',
      memoriesComplete: true,
      exportedAt: new Date('2026-08-09T04:00:00.000Z'),
    });
    const text = accountExportJson(payload);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text).version).toBe(ACCOUNT_EXPORT_VERSION);
  });

  it('fetchMemoriesForExport fails closed on HTTP errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: '请先连接主站账号' }), { status: 401 }),
    );
    const result = await fetchMemoriesForExport(fetchImpl);
    expect(result).toEqual({ ok: false, error: '请先连接主站账号' });
  });

  it('fetchMemoriesForExport flags page-limit truncation', async () => {
    const rows = Array.from({ length: MEMORIES_EXPORT_PAGE_LIMIT }, (_, i) =>
      memory(`m${i}`),
    );
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: rows }), { status: 200 }),
    );
    const result = await fetchMemoriesForExport(fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.memories).toHaveLength(MEMORIES_EXPORT_PAGE_LIMIT);
      expect(result.mayBeTruncated).toBe(true);
    }
  });

  it('fetchMemoriesForExport accepts shorter pages as complete', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [memory('m1')] }), { status: 200 }),
    );
    const result = await fetchMemoriesForExport(fetchImpl);
    expect(result).toEqual({
      ok: true,
      memories: [memory('m1')],
      mayBeTruncated: false,
    });
  });
});
