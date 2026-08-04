import { describe, expect, it } from 'vitest';
import {
  canPreviewGeneratedFile,
  isEpubFile,
  isPdfFile,
  isPreviewableImageFile,
  isPreviewableTextFile,
} from '@/lib/files/preview';

describe('canPreviewGeneratedFile', () => {
  it('allows inline content regardless of mime', () => {
    expect(
      canPreviewGeneratedFile({
        name: 'secret.bin',
        mimeType: 'application/octet-stream',
        content: 'hello',
      }),
    ).toBe(true);
  });

  it('allows url-only PDF and images', () => {
    expect(
      canPreviewGeneratedFile({
        name: 'book.pdf',
        mimeType: 'application/pdf',
        url: '/api/files/file_abc',
      }),
    ).toBe(true);
    expect(
      canPreviewGeneratedFile({
        name: 'shot.png',
        mimeType: 'image/png',
        url: '/api/files/file_img',
      }),
    ).toBe(true);
  });

  it('allows url-only text files (book download references)', () => {
    expect(
      canPreviewGeneratedFile({
        name: 'Novel.txt',
        mimeType: 'text/plain',
        url: '/api/files/file_txt',
      }),
    ).toBe(true);
    expect(
      canPreviewGeneratedFile({
        name: 'notes.md',
        mimeType: 'application/octet-stream',
        url: '/api/files/file_md',
      }),
    ).toBe(true);
  });

  it('allows url-only EPUB', () => {
    expect(
      canPreviewGeneratedFile({
        name: 'novel.epub',
        mimeType: 'application/epub+zip',
        url: '/api/files/file_epub',
      }),
    ).toBe(true);
  });

  it('rejects url-only non-previewable binaries', () => {
    expect(
      canPreviewGeneratedFile({
        name: 'archive.zip',
        mimeType: 'application/zip',
        url: '/api/files/file_zip',
      }),
    ).toBe(false);
  });

  it('rejects empty url without content', () => {
    expect(
      canPreviewGeneratedFile({
        name: 'notes.txt',
        mimeType: 'text/plain',
      }),
    ).toBe(false);
  });
});

describe('preview mime helpers', () => {
  it('detects pdf / epub / image / text', () => {
    expect(isPdfFile({ name: 'a.pdf', mimeType: 'application/octet-stream' })).toBe(true);
    expect(isEpubFile({ name: 'a.epub', mimeType: 'application/octet-stream' })).toBe(true);
    expect(isEpubFile({ mimeType: 'application/epub+zip' })).toBe(true);
    expect(isPreviewableImageFile({ name: 'a.webp' })).toBe(true);
    expect(isPreviewableTextFile({ name: 'a.csv', mime: 'application/octet-stream' })).toBe(
      true,
    );
    expect(isPreviewableTextFile({ mime: 'text/html' })).toBe(true);
  });
});
