import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  extractPptxText,
  extractSpreadsheetText,
} from '@/lib/files/ingest/extractors';
import {
  isPresentationFile,
  isSpreadsheetWorkbookFile,
  isSupportedDropFile,
  PPTX_MIME,
} from '@/lib/files/ingest/support';

function file(name: string, type: string, contents: BlobPart = 'x'): File {
  return new File([contents], name, { type });
}

function workbookFile(name: string, type: string, sheets: Record<string, unknown[][]>): File {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], name, { type });
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

  it('accepts legacy .doc by extension', () => {
    expect(isSupportedDropFile(file('legacy.doc', ''))).toBe(true);
  });

  it('accepts pptx by mime type or extension', () => {
    expect(isSupportedDropFile(file('deck.pptx', PPTX_MIME))).toBe(true);
    expect(isSupportedDropFile(file('deck.pptx', ''))).toBe(true);
    expect(isSupportedDropFile(file('legacy.ppt', ''))).toBe(true);
    expect(isPresentationFile(file('deck.pptx', ''))).toBe(true);
    expect(isPresentationFile(file('legacy.ppt', ''))).toBe(false);
  });

  it('accepts known source/code extensions', () => {
    for (const ext of ['md', 'csv', 'ts', 'tsx', 'py', 'yaml', 'sh']) {
      expect(isSupportedDropFile(file(`file.${ext}`, ''))).toBe(true);
    }
  });

  it('rejects unknown binary types', () => {
    expect(isSupportedDropFile(file('archive.zip', 'application/zip'))).toBe(false);
    expect(isSupportedDropFile(file('video.mov', 'video/quicktime'))).toBe(false);
  });
});

describe('extractPptxText', () => {
  it('extracts slide text with page markers', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Hello</a:t><a:t>World</a:t></p:sld>`,
    );
    zip.file(
      'ppt/slides/slide2.xml',
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Second</a:t></p:sld>`,
    );
    const buf = await zip.generateAsync({ type: 'uint8array' });
    const f = new File([buf], 'deck.pptx', { type: PPTX_MIME });
    const text = await extractPptxText(f);
    expect(text).toContain('--- page 1 ---');
    expect(text).toContain('Hello World');
    expect(text).toContain('--- page 2 ---');
    expect(text).toContain('Second');
  });
});

describe('extractSpreadsheetText', () => {
  it('renders sheets as TSV sections', async () => {
    const f = workbookFile(
      'sales.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      {
        Q1: [
          ['Item', 'Qty'],
          ['Apples', '3'],
          ['Oranges', '5'],
        ],
        Notes: [['hello']],
      },
    );
    const text = await extractSpreadsheetText(f);
    expect(text).toContain('## Sheet: Q1');
    expect(text).toContain('Item\tQty');
    expect(text).toContain('Apples\t3');
    expect(text).toContain('## Sheet: Notes');
    expect(text).toContain('hello');
  });
});
