import { describe, expect, it } from 'vitest';
import {
  ephemeralPaperPreviewEntry,
  ephemeralPreviewEntry,
  isEphemeralPaperPreviewId,
  isEphemeralPreviewId,
  literatureContentUrl,
  paperIdentifierFromContentUrl,
  paperPreviewContentUrl,
} from '@/lib/files/ephemeral-preview';

describe('ephemeral preview helpers', () => {
  it('builds paper content URL with encoded identifier', () => {
    const url = paperPreviewContentUrl('https://doi.org/10.1038/s41575-025-01108-1');
    expect(url).toBe(
      '/api/literature/papers/content?identifier=' +
        encodeURIComponent('https://doi.org/10.1038/s41575-025-01108-1'),
    );
  });

  it('creates ephemeral paper entry that is not a Files id', () => {
    const entry = ephemeralPaperPreviewEntry({
      identifier: 'ARXIV:1706.03762',
      title: 'Attention',
      filename: 'Attention.pdf',
    });
    expect(isEphemeralPaperPreviewId(entry.id)).toBe(true);
    expect(entry.id.startsWith('file-')).toBe(false);
    expect(entry.url).toContain('/api/literature/papers/content?');
    expect(paperIdentifierFromContentUrl(entry.url)).toBe('ARXIV:1706.03762');
    expect(entry.mimeType).toBe('application/pdf');
  });

  it('exposes book-shaped helpers for future books/content', () => {
    const url = literatureContentUrl('book', 'gutenberg:11');
    expect(url).toBe(
      '/api/literature/books/content?identifier=' +
        encodeURIComponent('gutenberg:11'),
    );
    const entry = ephemeralPreviewEntry({
      kind: 'book',
      identifier: 'gutenberg:11',
      title: 'Alice',
      filename: 'Alice.epub',
    });
    expect(isEphemeralPreviewId(entry.id, 'book')).toBe(true);
    expect(entry.url).toBe(url);
    expect(entry.mimeType).toBe('application/epub+zip');
  });
});
