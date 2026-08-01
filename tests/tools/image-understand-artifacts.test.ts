import { describe, expect, it } from 'vitest';
import {
  appendImageArchiveBlock,
  formatImageArchiveBlock,
  parseImageArchiveRefs,
  stripImageArchiveBlock,
  stripPersistedImageTranscription,
} from '@/lib/tools/image-understand/artifacts';

describe('image-understand artifacts', () => {
  it('round-trips archive block via parse/strip', () => {
    const refs = [{ fileId: 'abc123', url: '/api/files/abc123' }];
    const block = formatImageArchiveBlock(refs);
    expect(block).toContain('【原图存档】');
    expect(block).toContain('/api/files/abc123');

    const text = `hello\n\n${block}`;
    expect(parseImageArchiveRefs(text)).toEqual([
      { fileId: 'abc123', url: '/api/files/abc123' },
    ]);
    expect(stripImageArchiveBlock(text)).toBe('hello');
  });

  it('appendImageArchiveBlock replaces existing archive', () => {
    const first = appendImageArchiveBlock('user text', [{ fileId: 'a' }]);
    const second = appendImageArchiveBlock(first, [{ fileId: 'b' }]);
    expect(second).toContain('/api/files/b');
    expect(second).not.toContain('/api/files/a');
    expect(stripImageArchiveBlock(second)).toBe('user text');
  });

  it('stripPersistedImageTranscription removes injection prefix', () => {
    const injected =
      'question\n\n以下是图片内容（已转写，请当作你已看到该图，直接据此回答用户；不要解释这段转写本身，也不要向用户透露内部工具名或后端模型名称/版本）：\nscene description';
    expect(stripPersistedImageTranscription(injected)).toBe('question');
  });
});
