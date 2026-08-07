import { describe, expect, it } from 'vitest';
import {
  isPresentationFile,
  isSpreadsheetWorkbookFile,
  isSupportedDropFile,
  isZipArchiveFile,
  PPTX_MIME,
  ZIP_MIME,
} from '@/lib/files/ingest/support';

function file(name: string, type: string, contents: BlobPart = 'x'): File {
  return new File([contents], name, { type });
}

describe('isSupportedDropFile', () => {
  it('accepts images by mime type', () => {
    expect(isSupportedDropFile(file('photo.png', 'image/png'))).toBe(true);
  });

  it('accepts text and json mime types', () => {
    expect(isSupportedDropFile(file('notes.txt', 'text/plain'))).toBe(true);
    expect(isSupportedDropFile(file('data.json', 'application/json'))).toBe(true);
  });

  it('accepts pdf by mime type or extension', () => {
    expect(isSupportedDropFile(file('doc.pdf', 'application/pdf'))).toBe(true);
    expect(isSupportedDropFile(file('doc.pdf', ''))).toBe(true);
  });

  it('accepts docx by mime type or extension', () => {
    expect(
      isSupportedDropFile(
        file(
          'report.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ),
    ).toBe(true);
    expect(isSupportedDropFile(file('report.docx', ''))).toBe(true);
  });

  it('accepts xlsx/xls by mime type or extension', () => {
    expect(
      isSupportedDropFile(
        file(
          'book.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ),
    ).toBe(true);
    expect(isSupportedDropFile(file('book.xlsx', ''))).toBe(true);
    expect(isSupportedDropFile(file('legacy.xls', 'application/vnd.ms-excel'))).toBe(
      true,
    );
    expect(isSupportedDropFile(file('legacy.xls', ''))).toBe(true);
    expect(isSpreadsheetWorkbookFile(file('book.xlsx', ''))).toBe(true);
    expect(isSpreadsheetWorkbookFile(file('data.csv', 'text/csv'))).toBe(false);
  });

  it('rejects legacy .doc / .ppt (OLE binary; no browser extractor)', () => {
    expect(isSupportedDropFile(file('legacy.doc', ''))).toBe(false);
    expect(isSupportedDropFile(file('legacy.ppt', ''))).toBe(false);
    expect(isPresentationFile(file('legacy.ppt', ''))).toBe(false);
  });

  it('accepts pptx by mime type or extension', () => {
    expect(isSupportedDropFile(file('deck.pptx', PPTX_MIME))).toBe(true);
    expect(isSupportedDropFile(file('deck.pptx', ''))).toBe(true);
    expect(isPresentationFile(file('deck.pptx', ''))).toBe(true);
  });

  it('accepts zip archives by mime type or extension', () => {
    expect(isSupportedDropFile(file('archive.zip', ZIP_MIME))).toBe(true);
    expect(isSupportedDropFile(file('archive.zip', ''))).toBe(true);
    expect(isZipArchiveFile(file('archive.zip', ''))).toBe(true);
    expect(isZipArchiveFile(file('report.docx', ''))).toBe(false);
  });

  it('accepts known source/code extensions', () => {
    for (const ext of ['md', 'csv', 'ts', 'tsx', 'py', 'yaml', 'sh']) {
      expect(isSupportedDropFile(file(`file.${ext}`, ''))).toBe(true);
    }
  });

  it('accepts epub by mime type or extension', () => {
    expect(isSupportedDropFile(file('book.epub', 'application/epub+zip'))).toBe(true);
    expect(isSupportedDropFile(file('book.epub', ''))).toBe(true);
  });

  it('rejects unknown binary types', () => {
    expect(isSupportedDropFile(file('video.mov', 'video/quicktime'))).toBe(false);
    expect(isSupportedDropFile(file('payload.bin', 'application/octet-stream'))).toBe(
      false,
    );
  });
});
