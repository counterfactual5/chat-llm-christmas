import { describe, expect, it } from 'vitest';
import { cleanUrlExtractText } from '@/lib/files/url-extract-clean';

describe('cleanUrlExtractText', () => {
  it('strips Jina keyless header block at doc start', () => {
    const raw = 'Title: 简评Apple A19\nURL Source: https://zhuanlan.zhihu.com/p/1\nMarkdown Content:\n\nReal body here.';
    expect(cleanUrlExtractText(raw)).toBe('Real body here.');
  });

  it('only strips headers at the start — mid-body Title: lines survive', () => {
    const raw = 'Intro line.\n\nTitle: not a header\nMore text.';
    expect(cleanUrlExtractText(raw)).toBe(raw);
  });

  it('handles header block with no following body gracefully', () => {
    expect(cleanUrlExtractText('Title: X\nMarkdown Content:\n')).toBe('');
  });

  it('drops duplicated standalone title line when title is provided', () => {
    const raw = 'My Article\n\nBody text.';
    expect(cleanUrlExtractText(raw, { title: 'My Article' })).toBe('Body text.');
  });

  it('drops [Image N] and ![Image N](…) placeholder lines', () => {
    const raw = 'Before.\n\n[Image 1]\n\n![Image 2](https://x.test/a.jpg)\n\nAfter.';
    expect(cleanUrlExtractText(raw)).toBe('Before.\n\nAfter.');
  });

  it('keeps real markdown images with http(s) srcs', () => {
    const raw = 'Text.\n\n![chip photo](https://img.test/a19.png)\n\nMore.';
    expect(cleanUrlExtractText(raw)).toBe(raw);
  });

  it('keeps title-bearing markdown images', () => {
    const raw = 'Text.\n\n![chip](https://img.test/a19.png "A19 die shot")\n\nMore.';
    expect(cleanUrlExtractText(raw)).toBe(raw);
  });

  it('drops Creative Commons / zero badge images and linked badges', () => {
    const raw = [
      'Body.',
      '',
      '![Creative Commons License](https://licensebuttons.net/l/by/4.0/88x31.png)',
      '',
      '![zero](https://i.creativecommons.org/l/zero/1.0/80x15.png)',
      '',
      '[![Creative Commons License](https://licensebuttons.net/l/by/4.0/88x31.png)](https://creativecommons.org/licenses/by/4.0/)',
      '',
      '![article figure](https://cdn.test/photo.jpg)',
      '',
      'End.',
    ].join('\n');
    const cleaned = cleanUrlExtractText(raw);
    expect(cleaned).toBe('Body.\n\n![article figure](https://cdn.test/photo.jpg)\n\nEnd.');
  });

  it('drops images with empty, #, or javascript: srcs', () => {
    const raw = 'A\n![]()\n![]())(#)\n![x](javascript:alert(1))\nB';
    const cleaned = cleanUrlExtractText(raw);
    expect(cleaned).toContain('A');
    expect(cleaned).toContain('B');
    expect(cleaned).not.toContain('![');
  });

  it('collapses 3+ blank lines to 2', () => {
    expect(cleanUrlExtractText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('does not touch code fences or lists or headings', () => {
    const raw = '# H\n\n- item\n\n```\n[Image 1] inside fence stays? no — line rule applies everywhere; keep fence lines intact\n```\n';
    const cleaned = cleanUrlExtractText(raw);
    expect(cleaned).toContain('# H');
    expect(cleaned).toContain('- item');
    expect(cleaned).toContain('```');
  });

  it('is idempotent', () => {
    const raw = 'Title: X\nURL Source: https://a\nMarkdown Content:\n\nBody.\n\n[Image 3]\n\nEnd.';
    const once = cleanUrlExtractText(raw);
    expect(cleanUrlExtractText(once)).toBe(once);
  });

  it('rewrites about: citation links to footnote numbers', () => {
    const raw =
      'reasoning[15](about:/articles/s43856-025-01194-x#ref-CR15 "Liu, H. et al.\n\n(2023).") and more.';
    const cleaned = cleanUrlExtractText(raw);
    expect(cleaned).toContain('reasoning[15] and more.');
    expect(cleaned).not.toContain('about:');
  });

  it('keeps real http(s) links', () => {
    const raw = 'See [paper](https://doi.org/10.1000/xyz).';
    expect(cleanUrlExtractText(raw)).toBe(raw);
  });

  it('strips Fetch MCP pagination leftover tails', () => {
    const raw = 'End of chunk.\n\nto get more content.';
    expect(cleanUrlExtractText(raw)).toBe('End of chunk.');
  });

  it('empty / whitespace input → empty', () => {
    expect(cleanUrlExtractText('')).toBe('');
    expect(cleanUrlExtractText('   \n \n ')).toBe('');
  });
});
