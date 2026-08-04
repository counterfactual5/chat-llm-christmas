import { describe, expect, it } from 'vitest';
import { fileIdFromPreviewUrl } from '@/lib/files/direct-content';

describe('fileIdFromPreviewUrl', () => {
  it('extracts id from /api/files preview URLs', () => {
    expect(fileIdFromPreviewUrl('/api/files/file-abc123')).toBe('file-abc123');
    expect(
      fileIdFromPreviewUrl('/api/files/file-abc123?filename=book.epub'),
    ).toBe('file-abc123');
    expect(fileIdFromPreviewUrl('/api/files/file%2Dxyz')).toBe('file-xyz');
  });

  it('returns empty for non-proxy URLs', () => {
    expect(fileIdFromPreviewUrl('https://example.com/a.epub')).toBe('');
    expect(fileIdFromPreviewUrl('')).toBe('');
  });
});
