import { describe, expect, it } from 'vitest';
import { linkifyResearchCitations } from '@/lib/chat/message/research-links';

describe('linkifyResearchCitations', () => {
  it('turns bare [S1] and source-list rows into markdown links', () => {
    const urls = new Map([
      [1, 'https://example.com/a'],
      [2, 'https://example.com/b'],
    ]);
    const input = [
      '低温会引发痉挛 [S1]。也有人提到循环 [S2]。',
      '',
      '## 参考来源',
      '[S1] 红网病例报道',
      '[S2] 百度健康科普',
    ].join('\n');
    const out = linkifyResearchCitations(input, urls);
    expect(out).toContain('[S1](https://example.com/a)');
    expect(out).toContain('[S2](https://example.com/b)');
    expect(out).toContain('[S1] [红网病例报道](https://example.com/a)');
    expect(out).toContain('[S2] [百度健康科普](https://example.com/b)');
  });

  it('does not double-wrap already linked citations', () => {
    const urls = new Map([[1, 'https://example.com/a']]);
    const input = '见 [S1](https://example.com/a) 与 [S1] [标题](https://example.com/a)';
    expect(linkifyResearchCitations(input, urls)).toBe(input);
  });
});
