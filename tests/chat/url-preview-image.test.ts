import { describe, expect, it } from 'vitest';
import {
  classifyPreviewImageSrc,
  truncateImageAlt,
  truncateImageDescription,
  PREVIEW_IMAGE_ALT_MAX,
  PREVIEW_IMAGE_DESC_MAX,
} from '@/lib/files/url-preview-image';

describe('classifyPreviewImageSrc', () => {
  const BASE = 'https://example.com/articles/paper';

  it('returns remote for bare https URL', () => {
    expect(classifyPreviewImageSrc('https://img.test/a.png')).toEqual({
      kind: 'remote',
      src: 'https://img.test/a.png',
    });
  });

  it('returns remote for bare http URL', () => {
    expect(classifyPreviewImageSrc('http://img.test/a.png')).toEqual({
      kind: 'remote',
      src: 'http://img.test/a.png',
    });
  });

  it('returns skip for empty / whitespace', () => {
    expect(classifyPreviewImageSrc('')).toEqual({ kind: 'skip' });
    expect(classifyPreviewImageSrc('   ')).toEqual({ kind: 'skip' });
    expect(classifyPreviewImageSrc(null)).toEqual({ kind: 'skip' });
    expect(classifyPreviewImageSrc(undefined)).toEqual({ kind: 'skip' });
  });

  it('returns skip for data/blob/about URIs (never fetch from panel)', () => {
    expect(classifyPreviewImageSrc('data:image/png;base64,xxx')).toEqual({ kind: 'skip' });
    expect(classifyPreviewImageSrc('blob:https://x.test/abc')).toEqual({ kind: 'skip' });
    expect(classifyPreviewImageSrc('about:blank')).toEqual({ kind: 'skip' });
    expect(classifyPreviewImageSrc('javascript:void(0)')).toEqual({ kind: 'skip' });
  });

  it('resolves relative src against base URL', () => {
    expect(classifyPreviewImageSrc('/fig/1.png', BASE)).toEqual({
      kind: 'remote',
      src: 'https://example.com/fig/1.png',
    });
    expect(classifyPreviewImageSrc('../fig/2.png', BASE)).toEqual({
      kind: 'remote',
      src: 'https://example.com/fig/2.png',
    });
    expect(classifyPreviewImageSrc('fig/3.png', BASE)).toEqual({
      kind: 'remote',
      src: 'https://example.com/articles/fig/3.png',
    });
  });

  it('returns skip for relative src with no base URL', () => {
    expect(classifyPreviewImageSrc('/fig/1.png')).toEqual({ kind: 'skip' });
    expect(classifyPreviewImageSrc('fig.png')).toEqual({ kind: 'skip' });
    expect(classifyPreviewImageSrc('#anchor', BASE)).toEqual({ kind: 'skip' });
  });

  it('returns skip when base URL is invalid', () => {
    expect(classifyPreviewImageSrc('/fig/1.png', 'not a url')).toEqual({ kind: 'skip' });
    expect(classifyPreviewImageSrc('/fig/1.png', '')).toEqual({ kind: 'skip' });
  });
});

describe('truncateImageAlt', () => {
  it('collapses whitespace and trims', () => {
    expect(truncateImageAlt('  Fig   1:  A neuron\n')).toBe('Fig 1: A neuron');
  });

  it('returns empty for falsy input', () => {
    expect(truncateImageAlt('')).toBe('');
    expect(truncateImageAlt('   ')).toBe('');
    expect(truncateImageAlt(null)).toBe('');
    expect(truncateImageAlt(undefined)).toBe('');
  });

  it('truncates long alt with ellipsis', () => {
    const long = 'a'.repeat(PREVIEW_IMAGE_ALT_MAX + 10);
    const out = truncateImageAlt(long);
    expect(out.length).toBe(PREVIEW_IMAGE_ALT_MAX);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('truncateImageDescription', () => {
  it('returns empty for falsy', () => {
    expect(truncateImageDescription('')).toBe('');
    expect(truncateImageDescription(null)).toBe('');
  });

  it('leaves short text alone', () => {
    expect(truncateImageDescription('A simple chart.')).toBe('A simple chart.');
  });

  it('truncates long descriptions', () => {
    const long = 'word '.repeat(200);
    const out = truncateImageDescription(long);
    expect(out.length).toBe(PREVIEW_IMAGE_DESC_MAX);
    expect(out.endsWith('…')).toBe(true);
  });
});
