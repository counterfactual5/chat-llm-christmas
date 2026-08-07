import { describe, expect, it } from 'vitest';
import {
  canPreviewGeneratedFile,
  isEpubFile,
  isExtractSidecarPreviewFile,
  isPdfFile,
  isPreviewableImageFile,
  isPreviewableTextFile,
  isSpreadsheetPreviewFile,
  formatPreviewTypeLabel,
  needsExtractSidecarPreview,
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

  it('allows url-only office / zip via extract sidecar', () => {
    expect(
      canPreviewGeneratedFile({
        name: 'report.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        url: '/api/files/file_docx',
      }),
    ).toBe(true);
    expect(
      canPreviewGeneratedFile({
        name: 'archive.zip',
        mimeType: 'application/zip',
        url: '/api/files/file_zip',
      }),
    ).toBe(true);
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

describe('needsExtractSidecarPreview', () => {
  it('routes office/zip with fileId and no inline content to sidecar wait', () => {
    expect(
      needsExtractSidecarPreview({
        id: 'fid-docx',
        name: 'a.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe(true);
    expect(
      needsExtractSidecarPreview({
        id: 'fid-zip',
        name: 'pack.zip',
        mimeType: 'application/zip',
      }),
    ).toBe(true);
  });

  it('skips plain-text, pdf/epub, inline content, and local ids', () => {
    expect(
      needsExtractSidecarPreview({
        id: 'fid-txt',
        name: 'notes.txt',
        mimeType: 'text/plain',
      }),
    ).toBe(false);
    expect(
      needsExtractSidecarPreview({
        id: 'fid-pdf',
        name: 'a.pdf',
        mimeType: 'application/pdf',
      }),
    ).toBe(false);
    expect(
      needsExtractSidecarPreview({
        id: 'fid-docx',
        name: 'a.docx',
        content: 'already here',
      }),
    ).toBe(false);
    expect(
      needsExtractSidecarPreview({
        id: 'local:tmp',
        name: 'a.docx',
      }),
    ).toBe(false);
  });

  it('detects extract sidecar file kinds', () => {
    expect(isExtractSidecarPreviewFile({ name: 'a.docx' })).toBe(true);
    expect(isExtractSidecarPreviewFile({ name: 'a.xlsx' })).toBe(true);
    expect(isExtractSidecarPreviewFile({ name: 'a.pptx' })).toBe(true);
    expect(isExtractSidecarPreviewFile({ name: 'a.zip' })).toBe(true);
    expect(isExtractSidecarPreviewFile({ name: 'a.pdf' })).toBe(false);
    expect(isExtractSidecarPreviewFile({ name: 'a.md' })).toBe(false);
  });
});

describe('preview mime helpers', () => {
  it('detects pdf / epub / image / text / spreadsheet', () => {
    expect(isPdfFile({ name: 'a.pdf', mimeType: 'application/octet-stream' })).toBe(true);
    expect(isEpubFile({ name: 'a.epub', mimeType: 'application/octet-stream' })).toBe(true);
    expect(isEpubFile({ mimeType: 'application/epub+zip' })).toBe(true);
    expect(isPreviewableImageFile({ name: 'a.webp' })).toBe(true);
    expect(isPreviewableTextFile({ name: 'a.csv', mime: 'application/octet-stream' })).toBe(
      true,
    );
    expect(isPreviewableTextFile({ mime: 'text/html' })).toBe(true);
    expect(
      isSpreadsheetPreviewFile({
        name: 'report.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ).toBe(true);
    expect(isSpreadsheetPreviewFile({ name: 'data.csv' })).toBe(true);
    expect(formatPreviewTypeLabel({ name: 'a.epub', mimeType: 'application/epub+zip' })).toBe(
      'EPUB',
    );
    expect(formatPreviewTypeLabel({ name: 'a.pdf', mimeType: 'application/pdf' })).toBe('PDF');
  });
});
