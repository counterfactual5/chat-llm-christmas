import { describe, expect, it } from 'vitest';
import {
  decideMemoryExtraction,
  looksLikeMemoryCue,
  messagesAfterCursor,
  MEMORY_IDLE_MS,
  MEMORY_MAX_USER_TURNS,
} from '@/lib/memories/trigger';
import {
  formatMemoriesForSystemPrompt,
  parseMemoryExtractionResponse,
} from '@/lib/memories/prompt';
import {
  parseMemoriesMarkdown,
  serializeMemoriesMarkdown,
} from '@/lib/memories/markdown';

describe('memory triggers', () => {
  it('detects explicit memory cues in Chinese and English', () => {
    expect(looksLikeMemoryCue('记住：以后不要自动提交')).toBe(true);
    expect(looksLikeMemoryCue('Please remember that I prefer Chinese')).toBe(true);
    expect(looksLikeMemoryCue('今天天气怎么样')).toBe(false);
  });

  it('extracts immediately on cue, otherwise waits for idle/turn limits', () => {
    const pending = [
      { role: 'user', content: '记住我偏好中文回答' },
      { role: 'assistant', content: '好的' },
    ];
    expect(
      decideMemoryExtraction({ pendingMessages: pending, idleMs: 0 }),
    ).toEqual({ shouldExtract: true, reason: 'cue' });

    const normal = Array.from({ length: MEMORY_MAX_USER_TURNS }, (_, i) => ({
      role: 'user' as const,
      content: `普通问题 ${i}`,
    }));
    expect(
      decideMemoryExtraction({ pendingMessages: normal, idleMs: 0 }),
    ).toEqual({ shouldExtract: true, reason: 'turn_limit' });

    expect(
      decideMemoryExtraction({
        pendingMessages: [{ role: 'user', content: '短问' }],
        idleMs: MEMORY_IDLE_MS,
      }),
    ).toEqual({ shouldExtract: true, reason: 'idle' });

    expect(
      decideMemoryExtraction({
        pendingMessages: [{ role: 'user', content: '短问' }],
        idleMs: 1000,
      }),
    ).toEqual({ shouldExtract: false, reason: 'waiting' });
  });

  it('slices messages after the extraction cursor', () => {
    const messages = [
      { id: 'a', role: 'user' },
      { id: 'b', role: 'assistant' },
      { id: 'c', role: 'user' },
    ];
    expect(messagesAfterCursor(messages, 'b').map((m) => m.id)).toEqual(['c']);
    expect(messagesAfterCursor(messages, null).map((m) => m.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('memory prompt helpers', () => {
  it('formats enabled memories for the system prompt', () => {
    const block = formatMemoriesForSystemPrompt([
      { kind: 'preference', content: '用户偏好中文' },
      { kind: 'instruction', content: '  ' },
    ]);
    expect(block).toContain('Known facts about the user');
    expect(block).toContain('[preference] 用户偏好中文');
    expect(block).not.toContain('instruction');
  });

  it('parses JSON or fenced extraction responses and filters bad kinds', () => {
    const raw = [
      '```json',
      JSON.stringify({
        memories: [
          {
            kind: 'preference',
            content: '用户偏好简洁回答',
            confidence: 0.9,
          },
          { kind: 'secret', content: 'should skip' },
          { kind: 'decision', content: '暂不做 RAG', confidence: 0.8 },
        ],
      }),
      '```',
    ].join('\n');
    expect(parseMemoryExtractionResponse(raw)).toEqual([
      {
        kind: 'preference',
        content: '用户偏好简洁回答',
        confidence: 0.9,
      },
      {
        kind: 'decision',
        content: '暂不做 RAG',
        confidence: 0.8,
      },
    ]);
  });
});

describe('MEMORY.md serialization', () => {
  it('round-trips sectioned markdown including disabled items', () => {
    const markdown = serializeMemoriesMarkdown([
      { kind: 'preference', content: '用户偏好中文', enabled: true },
      { kind: 'decision', content: '暂不做 RAG', enabled: true },
      { kind: 'preference', content: '旧偏好', enabled: false },
    ]);

    expect(markdown).toContain('# Memory');
    expect(markdown).toContain('## Preference');
    expect(markdown).toContain('- 用户偏好中文');
    expect(markdown).toContain('## Decision');
    expect(markdown).toContain('## Disabled');
    expect(markdown).toContain('- [preference] 旧偏好');

    expect(parseMemoriesMarkdown(markdown)).toEqual([
      { kind: 'preference', content: '用户偏好中文', enabled: true },
      { kind: 'decision', content: '暂不做 RAG', enabled: true },
      { kind: 'preference', content: '旧偏好', enabled: false },
    ]);
  });

  it('parses tagged bullets without section context', () => {
    expect(
      parseMemoriesMarkdown(
        ['# Memory', '- [instruction] 不要自动提交', '- [profile] 使用 macOS'].join(
          '\n',
        ),
      ),
    ).toEqual([
      { kind: 'instruction', content: '不要自动提交', enabled: true },
      { kind: 'profile', content: '使用 macOS', enabled: true },
    ]);
  });
});
