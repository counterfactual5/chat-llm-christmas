import { describe, expect, it, vi } from 'vitest';
import {
  buildImageGenerationThread,
  requestImageGeneration,
} from '@/lib/chat/turn/image-generation';
import type { Message } from '@/lib/chat/types';

function msg(partial: Partial<Message> & Pick<Message, 'role' | 'content'>): Message {
  return {
    id: partial.id || 'm',
    role: partial.role,
    content: partial.content,
    timestamp: partial.timestamp ?? 1,
    incomplete: partial.incomplete,
  };
}

describe('buildImageGenerationThread', () => {
  const genId = (() => {
    let n = 0;
    return () => `id-${++n}`;
  })();

  it('appends a /image user turn + placeholder assistant bubble', () => {
    const result = buildImageGenerationThread({
      prompt: 'a cat',
      cleanedBase: [msg({ id: 'u0', role: 'user', content: 'hi' })],
      now: () => 42,
      genId,
    });
    expect(result.thread.map((m) => m.role)).toEqual(['user', 'user', 'assistant']);
    expect(result.thread[1].content).toBe('/image a cat');
    expect(result.thread[2].id).toBe(result.assistantId);
    expect(result.thread[2].incomplete).toBe(true);
    expect(result.newTitle).toBeUndefined();
  });

  it('skips the duplicate user turn on retry and reuses the prior thread', () => {
    const result = buildImageGenerationThread({
      prompt: 'a cat',
      cleanedBase: [msg({ id: 'u0', role: 'user', content: '/image a cat' })],
      skipDuplicateUser: true,
      currentTitle: 'Existing',
      now: () => 1,
      genId,
    });
    expect(result.thread.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(result.newTitle).toBe('a cat');
  });

  it('derives a new-conversation title only for an empty base thread', () => {
    const longPrompt = 'x'.repeat(35);
    const empty = buildImageGenerationThread({
      prompt: longPrompt,
      cleanedBase: [],
      currentTitle: 'Old title',
      genId,
    });
    expect(empty.newTitle).toBe(`${'x'.repeat(30)}...`);

    const nonEmpty = buildImageGenerationThread({
      prompt: 'a cat',
      cleanedBase: [msg({ id: 'u0', role: 'user', content: 'hi' })],
      currentTitle: 'Old title',
      genId,
    });
    expect(nonEmpty.newTitle).toBe('Old title');
  });
});

describe('requestImageGeneration', () => {
  it('returns the image + fileId on success', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ image: 'data:image/png;base64,xx', fileId: 42 }),
    })) as unknown as typeof fetch;

    const result = await requestImageGeneration({ prompt: 'a cat' }, { fetchImpl });
    expect(result).toEqual({ ok: true, image: 'data:image/png;base64,xx', fileId: '42' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/images',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces the server error message on non-2xx JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'quota exceeded' }),
    })) as unknown as typeof fetch;

    const result = await requestImageGeneration({ prompt: 'a cat' }, { fetchImpl });
    expect(result).toEqual({ ok: false, error: 'quota exceeded' });
  });

  it('falls back to a truncated body when the response is not JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => '<html>Bad Gateway</html>',
    })) as unknown as typeof fetch;

    const result = await requestImageGeneration({ prompt: 'a cat' }, { fetchImpl });
    expect(result).toEqual({ ok: false, error: '<html>Bad Gateway</html>' });
  });

  it('reports a missing image field on an otherwise-ok response', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    })) as unknown as typeof fetch;

    const result = await requestImageGeneration({ prompt: 'a cat' }, { fetchImpl });
    expect(result).toEqual({ ok: false, error: 'No image returned' });
  });
});
