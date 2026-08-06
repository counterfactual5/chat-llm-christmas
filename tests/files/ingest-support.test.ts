import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  docxPagedExtractFromHtml,
  extractPptxText,
  extractSpreadsheetText,
  extractZipText,
} from '@/lib/files/ingest/extractors';
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

  it('rejects unknown binary types', () => {
    expect(isSupportedDropFile(file('video.mov', 'video/quicktime'))).toBe(false);
    expect(isSupportedDropFile(file('payload.bin', 'application/octet-stream'))).toBe(
      false,
    );
  });
});

describe('extractPptxText', () => {
  it('builds outline catalog + slide content pages', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Hello</a:t><a:t>World</a:t></p:sld>`,
    );
    zip.file(
      'ppt/slides/slide2.xml',
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:sld>`,
    );
    zip.file(
      'ppt/slides/slide3.xml',
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><a:t>Caption</a:t><p:pic><a:blip/></p:pic></p:sld>`,
    );
    const buf = await zip.generateAsync({ type: 'uint8array' });
    const f = new File([new Uint8Array(buf)], 'deck.pptx', { type: PPTX_MIME });
    const text = await extractPptxText(f);
    expect(text).toContain('--- page 1 ---');
    expect(text).toContain('PPTX outline: deck.pptx');
    expect(text).toContain('Slide 1');
    expect(text).toContain('extracted → page 2');
    expect(text).toContain('image-only');
    expect(text).toContain('has image');
    expect(text).toContain('--- page 2 ---');
    expect(text).toContain('Hello World');
    expect(text).toContain('--- page 3 ---');
    expect(text).toContain('[image-only slide — use file_read for OCR]');
    expect(text).toContain('--- page 4 ---');
    expect(text).toContain('Caption');
  });
});

describe('extractZipText', () => {
  it('builds catalog + content pages for whitelisted members', async () => {
    const zip = new JSZip();
    zip.file('readme.md', '# Hello ZIP\n');
    zip.file('nested/notes.txt', 'plain notes');
    zip.file('shot.png', 'fakepng');
    zip.file('bin/tool.exe', 'MZ-fake');
    zip.file('inner.zip', 'PK-fake');
    const buf = await zip.generateAsync({ type: 'uint8array' });
    const f = new File([new Uint8Array(buf)], 'bundle.zip', { type: ZIP_MIME });
    const text = await extractZipText(f);
    expect(text).toContain('--- page 1 ---');
    expect(text).toContain('ZIP catalog: bundle.zip');
    expect(text).toContain('readme.md');
    expect(text).toContain('extracted → page');
    expect(text).toContain('shot.png');
    expect(text).toContain('image-only');
    expect(text).toContain('use file_read');
    expect(text).toContain('tool.exe');
    expect(text).toContain('skipped: unsupported');
    expect(text).toContain('inner.zip');
    expect(text).toContain('skipped: nested archive');
    expect(text).toContain('--- page 2 ---');
    expect(text).toContain('Hello ZIP');
    expect(text).toContain('plain notes');
  });
});

describe('extractDocxText', () => {
  it('builds outline catalog + section pages from headings', () => {
    const text = docxPagedExtractFromHtml(
      '<h1>Intro</h1><p>Hello body</p><h1>Next</h1><p>More text</p>',
      'report.docx',
    );
    expect(text).toContain('--- page 1 ---');
    expect(text).toContain('DOCX outline: report.docx');
    expect(text).toContain('Intro · section · extracted → page 2');
    expect(text).toContain('--- page 2 ---');
    expect(text).toContain('## Intro');
    expect(text).toContain('Hello body');
    expect(text).toContain('--- page 3 ---');
    expect(text).toContain('## Next');
    expect(text).toContain('More text');
  });

  it('marks sections that contain images', () => {
    const text = docxPagedExtractFromHtml(
      '<h1>Cover</h1><p><img src="x.png" alt=""/></p><h1>Text</h1><p>Only words</p>',
      'pics.docx',
    );
    expect(text).toContain('Cover · section · image-only · extracted → page 2');
    expect(text).toContain('[image-only section — use file_read for OCR]');
    expect(text).toContain('Text · section · extracted → page 3');
    expect(text).not.toContain('Text · section · has image');
  });
});

describe('extractSpreadsheetText', () => {
  it('builds sheet catalog + one page per sheet', async () => {
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
    expect(text).toContain('--- page 1 ---');
    expect(text).toContain('Excel sheets: sales.xlsx');
    expect(text).toContain('Q1 · sheet · extracted → page 2');
    expect(text).toContain('--- page 2 ---');
    expect(text).toContain('## Sheet: Q1');
    expect(text).toContain('Item\tQty');
    expect(text).toContain('Apples\t3');
    expect(text).toContain('--- page 3 ---');
    expect(text).toContain('## Sheet: Notes');
    expect(text).toContain('hello');
  });
});
