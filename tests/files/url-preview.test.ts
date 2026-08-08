import { describe, expect, it } from 'vitest';
import {
  isJunkBookExtractHost,
  isLikelyAuthGatedPreviewUrl,
  isLikelyBookPreviewUrl,
  isLikelyDirectLiteratureFileUrl,
  isLikelyPaperPreviewUrl,
  isPreviewableHttpUrl,
  normalizePreviewHttpUrl,
  previewNavigationTargetEquals,
  resolvePreviewHttpUrl,
  shouldOpenLinkExternally,
} from '@/lib/files/url-preview';

describe('url-preview helpers', () => {
  it('accepts absolute http(s) URLs only', () => {
    expect(isPreviewableHttpUrl('https://example.com/a')).toBe(true);
    expect(isPreviewableHttpUrl('http://example.com')).toBe(true);
    expect(isPreviewableHttpUrl('/api/files/file-abc')).toBe(false);
    expect(isPreviewableHttpUrl('mailto:a@b.com')).toBe(false);
    expect(isPreviewableHttpUrl('data:text/plain,hi')).toBe(false);
    expect(isPreviewableHttpUrl('local://x')).toBe(false);
    expect(isPreviewableHttpUrl('')).toBe(false);
  });

  it('normalizes bare hosts and rejects non-web schemes', () => {
    expect(normalizePreviewHttpUrl('example.com/path')).toBe('https://example.com/path');
    expect(normalizePreviewHttpUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizePreviewHttpUrl('/api/files/x')).toBe('');
    expect(normalizePreviewHttpUrl('mailto:a@b.com')).toBe('');
  });

  it('detects modifier / middle-click as external open', () => {
    expect(shouldOpenLinkExternally({})).toBe(false);
    expect(shouldOpenLinkExternally({ metaKey: true })).toBe(true);
    expect(shouldOpenLinkExternally({ ctrlKey: true })).toBe(true);
    expect(shouldOpenLinkExternally({ button: 1 })).toBe(true);
  });

  it('flags paper / DOI hosts for OA-first preview', () => {
    expect(isLikelyPaperPreviewUrl('https://doi.org/10.1038/s41575-025-01108-1')).toBe(
      true,
    );
    expect(isLikelyPaperPreviewUrl('https://arxiv.org/abs/1706.03762')).toBe(true);
    expect(isLikelyPaperPreviewUrl('https://www.nature.com/articles/s41575-025-01108-1')).toBe(
      true,
    );
    expect(isLikelyPaperPreviewUrl('https://openalex.org/W4407173730')).toBe(true);
    expect(
      isLikelyPaperPreviewUrl('https://arxiv.org/pdf/1706.03762.pdf'),
    ).toBe(true);
    expect(
      isLikelyPaperPreviewUrl('https://cdn.example.org/papers/paper.pdf'),
    ).toBe(true);
    expect(isLikelyPaperPreviewUrl('https://example.com/blog')).toBe(false);
  });

  it('flags direct literature file URLs', () => {
    expect(isLikelyDirectLiteratureFileUrl('https://cdn.example/a.pdf')).toBe(true);
    expect(isLikelyDirectLiteratureFileUrl('https://arxiv.org/pdf/1706.03762')).toBe(
      true,
    );
    expect(isLikelyDirectLiteratureFileUrl('https://cdn.example/book.epub')).toBe(true);
    expect(isLikelyDirectLiteratureFileUrl('https://example.com/blog')).toBe(false);
  });

  it('flags archive.org / gutenberg / libgen book landing URLs', () => {
    expect(
      isLikelyBookPreviewUrl('https://archive.org/details/aliceinwonderland00carrrich'),
    ).toBe(true);
    expect(isLikelyBookPreviewUrl('https://www.gutenberg.org/ebooks/11')).toBe(true);
    expect(
      isLikelyBookPreviewUrl(
        'https://libgen.li/ads.php?md5=f370d2605d3cc160902406c9724c00ef',
      ),
    ).toBe(true);
    expect(
      isLikelyBookPreviewUrl(
        'https://library.lol/main/f370d2605d3cc160902406c9724c00ef',
      ),
    ).toBe(true);
    expect(isLikelyBookPreviewUrl('https://cdn.example/book.epub')).toBe(true);
    expect(isLikelyBookPreviewUrl('https://cdn.example/book.pdf')).toBe(true);
    expect(isLikelyBookPreviewUrl('https://example.com/blog')).toBe(false);
    expect(isLikelyBookPreviewUrl('https://doi.org/10.1038/s41575-025-01108-1')).toBe(
      false,
    );
  });

  it('marks libgen landing hosts as junk extract', () => {
    expect(
      isJunkBookExtractHost(
        'https://libgen.li/ads.php?md5=f370d2605d3cc160902406c9724c00ef',
      ),
    ).toBe(true);
    expect(
      isJunkBookExtractHost('https://archive.org/details/aliceinwonderland00carrrich'),
    ).toBe(false);
  });

  it('flags auth-gated hosts that cannot reuse browser login in-panel', () => {
    expect(isLikelyAuthGatedPreviewUrl('https://www.notion.so/Page-abc')).toBe(true);
    expect(isLikelyAuthGatedPreviewUrl('https://foo.notion.site/bar')).toBe(true);
    expect(isLikelyAuthGatedPreviewUrl('https://docs.google.com/document/d/x')).toBe(true);
    expect(isLikelyAuthGatedPreviewUrl('https://linear.app/team/issue/ABC-1')).toBe(true);
    expect(isLikelyAuthGatedPreviewUrl('https://example.com/page')).toBe(false);
    expect(isLikelyAuthGatedPreviewUrl('not-a-url')).toBe(false);
  });

  it('resolves absolute and relative preview hrefs against an optional base', () => {
    expect(resolvePreviewHttpUrl('https://a.com/b')).toBe('https://a.com/b');
    expect(
      resolvePreviewHttpUrl('/wiki/Foo', 'https://en.wikipedia.org/wiki/Bar'),
    ).toBe('https://en.wikipedia.org/wiki/Foo');
    expect(resolvePreviewHttpUrl('../x', 'https://example.com/a/b/')).toBe(
      'https://example.com/a/x',
    );
    expect(resolvePreviewHttpUrl('?q=1', 'https://example.com/a/b')).toBe(
      'https://example.com/a/b?q=1',
    );
    expect(resolvePreviewHttpUrl('/wiki/Foo')).toBe('');
    expect(resolvePreviewHttpUrl('mailto:a@b.com', 'https://example.com')).toBe('');
    expect(resolvePreviewHttpUrl('/api/files/x', 'https://example.com')).toBe('');
    expect(resolvePreviewHttpUrl('https://a.com/b')).toBe(
      resolvePreviewHttpUrl('https://a.com/b'),
    );
  });

  it('requires a base for protocol-relative hrefs (no invented https)', () => {
    expect(resolvePreviewHttpUrl('//example.com/x')).toBe('');
    expect(resolvePreviewHttpUrl('//example.com/x', 'https://en.wikipedia.org/')).toBe(
      'https://example.com/x',
    );
    expect(resolvePreviewHttpUrl('//example.com/x', 'http://en.wikipedia.org/')).toBe(
      'http://example.com/x',
    );
  });

  it('treats same-document targets as equal when only the hash differs', () => {
    expect(
      previewNavigationTargetEquals(
        'https://en.wikipedia.org/wiki/Bar#section',
        'https://en.wikipedia.org/wiki/Bar',
      ),
    ).toBe(true);
    expect(
      previewNavigationTargetEquals(
        'https://en.wikipedia.org/wiki/Foo',
        'https://en.wikipedia.org/wiki/Bar',
      ),
    ).toBe(false);
    expect(resolvePreviewHttpUrl('#cite', 'https://en.wikipedia.org/wiki/Bar')).toBe(
      'https://en.wikipedia.org/wiki/Bar#cite',
    );
  });
});
