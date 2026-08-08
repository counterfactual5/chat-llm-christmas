import { describe, expect, it } from 'vitest';
import {
  mergeSyncedSessions,
  normalizeRestoredSession,
  sessionsForCloudSync,
} from '@/lib/chat/session/store';
import type { ChatSession } from '@/lib/chat/types';

function session(id: string, updatedAt: number, content = 'hello'): ChatSession {
  return {
    id,
    title: id,
    updatedAt,
    messages: [{ id: `${id}-message`, role: 'user', content, timestamp: updatedAt }],
  };
}

describe('chat sessions', () => {
  it('keeps the newer cloud version and returns sessions newest first', () => {
    const merged = mergeSyncedSessions(
      [session('local-only', 30), session('shared', 10, 'local')],
      [session('shared', 20, 'cloud'), session('cloud-only', 40)],
    );

    expect(merged.map((item) => item.id)).toEqual(['cloud-only', 'local-only', 'shared']);
    expect(merged.find((item) => item.id === 'shared')?.messages[0]?.content).toBe('cloud');
  });

  it('preserves local model when a newer cloud row omits it', () => {
    const local: ChatSession = {
      ...session('shared', 10, 'local'),
      model: 'local-model',
      mcpIds: ['paper_search'],
    };
    const cloud: ChatSession = {
      ...session('shared', 20, 'cloud'),
      // legacy peer — no model / mcp
    };
    const merged = mergeSyncedSessions([local], [cloud]);
    const shared = merged.find((item) => item.id === 'shared');
    expect(shared?.messages[0]?.content).toBe('cloud');
    expect(shared?.model).toBe('local-model');
    expect(shared?.mcpIds).toEqual(['paper_search']);
  });

  it('patchSessionModel can remap without bumping updatedAt', async () => {
    const { patchSessionModel } = await import('@/lib/chat/session/tool-flags');
    const before: ChatSession = {
      ...session('A', 100),
      model: 'dead-model',
    };
    const next = patchSessionModel([before], 'A', 'alive-model', {
      touchUpdatedAt: false,
    });
    expect(next[0]?.model).toBe('alive-model');
    expect(next[0]?.updatedAt).toBe(100);
  });

  it('normalizes an interrupted restored assistant message', () => {
    const restored = normalizeRestoredSession({
      ...session('interrupted', 1),
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'partial',
          timestamp: 1,
          incomplete: true,
          toolRuns: [{ id: 'tool-1', name: 'web_search', status: 'start' }],
        },
      ],
    });

    expect(restored.messages[0]).toMatchObject({
      incomplete: true,
      truncationReason: 'Reply was interrupted',
      toolRuns: [{ id: 'tool-1', status: 'done' }],
    });
  });

  it('scrubs only oversized inline data URLs before cloud sync', () => {
    const largeDataUrl = `data:image/png;base64,${'a'.repeat(102_401)}`;
    const result = sessionsForCloudSync([
      {
        ...session('images', 1),
        messages: [
          {
            id: 'image-message',
            role: 'user',
            content: 'image',
            timestamp: 1,
            images: [
              { url: largeDataUrl },
              { url: 'data:image/png;base64,short' },
              { url: 'https://example.com/image.png' },
            ],
          },
        ],
      },
    ]);

    const images = result[0]?.messages[0]?.images;
    expect(images?.map((image) => image.url)).toEqual([
      '',
      'data:image/png;base64,short',
      'https://example.com/image.png',
    ]);
  });
});
