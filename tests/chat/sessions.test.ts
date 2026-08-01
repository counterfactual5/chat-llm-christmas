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
