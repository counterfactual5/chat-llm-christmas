import { describe, expect, it } from 'vitest';
import {
  createThinkStreamParser,
  extractThinkBlocks,
} from '@/lib/chat/message/think-tags';
import { displayAssistantParts } from '@/lib/chat/message/display';
import type { Message } from '@/lib/chat/types';

describe('extractThinkBlocks', () => {
  it('splits normal <think>…</think> pairs', () => {
    const out = extractThinkBlocks('hello <think>secret</think> world');
    expect(out.reasoning).toBe('secret');
    expect(out.content.trim()).toBe('hello  world');
  });

  it('treats orphan </think> prefix as reasoning (missing open tag)', () => {
    const out = extractThinkBlocks(
      '草稿能力列表。\n\n</think>\n\n正式回答：我可以做这些。',
    );
    expect(out.reasoning).toContain('草稿能力列表');
    expect(out.content).toContain('正式回答：我可以做这些。');
    expect(out.content).not.toContain('</think>');
    expect(out.content).not.toContain('草稿能力列表');
  });
});

describe('createThinkStreamParser orphan close', () => {
  it('handles orphan close arriving across chunks', () => {
    const p = createThinkStreamParser();
    const a = p.push('hidden draft');
    expect(a.content).toBe('hidden draft');
    expect(a.orphanClose).toBe(false);
    const b = p.push('.</think>visible');
    expect(b.orphanClose).toBe(true);
    expect(b.reasoning).toContain('.');
    expect(b.content).toBe('visible');
    const c = p.flush();
    expect(c.content + c.reasoning).toBe('');
    expect(c.orphanClose).toBe(false);
  });
});

describe('displayAssistantParts', () => {
  it('moves orphan-close draft into the Thought panel', () => {
    const message = {
      id: 'a1',
      role: 'assistant',
      content: '金融口径草稿</think>\n\n正式能力说明',
    } as Message;
    const parts = displayAssistantParts(message);
    expect(parts.reasoning).toContain('金融口径草稿');
    expect(parts.content.trim()).toBe('正式能力说明');
  });
});
