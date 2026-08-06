import { describe, expect, it } from 'vitest';
import {
  isPreviewableHttpUrl,
  normalizePreviewHttpUrl,
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
});
