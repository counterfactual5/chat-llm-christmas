import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { fixGreedyAutolinks } from '@/lib/markdown/core/autolinks';
import { prepareChatMarkdown } from '@/lib/markdown/math';

function linkUrls(md: string): string[] {
  const tree: any = unified().use(remarkParse).use(remarkGfm).parse(md);
  const urls: string[] = [];
  (function walk(n: any) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'link') urls.push(String(n.url || ''));
    for (const c of n.children || []) walk(c);
  })(tree);
  return urls;
}

describe('fixGreedyAutolinks', () => {
  it('splits bare URLs flush against CJK / fullwidth punctuation', () => {
    expect(fixGreedyAutolinks('进入 https://groups.google.com/,搜索 Monash')).toBe(
      '进入 [https://groups.google.com/](https://groups.google.com/),搜索 Monash',
    );
    expect(fixGreedyAutolinks('见 https://example.com/，谢谢')).toBe(
      '见 [https://example.com/](https://example.com/)，谢谢',
    );
    expect(fixGreedyAutolinks('打开 https://example.com/path搜索')).toBe(
      '打开 [https://example.com/path](https://example.com/path)搜索',
    );
  });

  it('leaves space-separated bare URLs alone for GFM', () => {
    const raw = '进入 https://groups.google.com/, 搜索 Monash';
    expect(fixGreedyAutolinks(raw)).toBe(raw);
  });

  it('does not rewrite markdown link destinations', () => {
    const raw = '看 [首页](https://example.com/文档) 即可';
    expect(fixGreedyAutolinks(raw)).toBe(raw);
  });

  it('leaves fenced code untouched', () => {
    const code = '```\nhttps://example.com/搜索\n```';
    expect(fixGreedyAutolinks(code)).toBe(code);
  });
});

describe('prepareChatMarkdown + greedy autolinks', () => {
  it('keeps CJK out of the parsed href', () => {
    const prepared = prepareChatMarkdown(
      '进入 https://groups.google.com/,搜索 **Monash Blockchain Club**',
    );
    expect(linkUrls(prepared)).toEqual(['https://groups.google.com/']);
  });
});
