import { describe, expect, it } from 'vitest';
import {
  ephemeralPaperPreviewEntry,
  isEphemeralPaperPreviewId,
  paperIdentifierFromContentUrl,
  paperPreviewContentUrl,
} from '@/lib/chat/turn/literature-search';

describe('paper ephemeral preview helpers', () => {
  it('builds content URL with encoded identifier', () => {
    const url = paperPreviewContentUrl('https://doi.org/10.1038/s41575-025-01108-1');
    expect(url).toBe(
      '/api/literature/papers/content?identifier=' +
        encodeURIComponent('https://doi.org/10.1038/s41575-025-01108-1'),
    );
  });

  it('creates ephemeral entry that is not a Files id', () => {
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
});
