import { describe, expect, it } from 'vitest';
import { pagesNeedingOcrInWindow } from '@/lib/tools/file-read/tool';

describe('pagesNeedingOcrInWindow', () => {
  it('OCRs known-empty TextBased pages (整本误判兜底, capped at 2)', () => {
    expect(
      pagesNeedingOcrInWindow({
        pages: [
          { page: 1, text: '' },
          { page: 2, text: 'normal chapter text '.repeat(10) },
          { page: 3, text: '' },
          { page: 4, text: '' },
        ],
        startPage: 1,
        maxPages: 8,
        pagesNeedingOcr: [],
        pdfType: 'TextBased',
      }),
    ).toEqual([1, 3]);
  });

  it('does not OCR TextBased pages not yet in the extract', () => {
    expect(
      pagesNeedingOcrInWindow({
        pages: [{ page: 2, text: 'body '.repeat(20) }],
        startPage: 1,
        maxPages: 3,
        pagesNeedingOcr: [],
        pdfType: 'TextBased',
      }),
    ).toEqual([]);
  });

  it('OCRs listed and unlisted empty Mixed pages in the window (漏检兜底)', () => {
    expect(
      pagesNeedingOcrInWindow({
        pages: [
          { page: 1, text: '' },
          { page: 2, text: 'chapter body '.repeat(20) },
          { page: 3, text: '' },
        ],
        startPage: 1,
        maxPages: 8,
        pagesNeedingOcr: [1],
        pdfType: 'Mixed',
      }),
    ).toEqual([1, 3]);
  });

  it('OCRs empty Scanned window pages', () => {
    expect(
      pagesNeedingOcrInWindow({
        pages: [
          { page: 1, text: '' },
          { page: 2, text: '' },
          { page: 3, text: '' },
        ],
        startPage: 1,
        maxPages: 2,
        pagesNeedingOcr: [],
        pdfType: 'Scanned',
      }),
    ).toEqual([1, 2]);
  });

  it('skips pages that already have text', () => {
    expect(
      pagesNeedingOcrInWindow({
        pages: [{ page: 5, text: 'enough text '.repeat(10) }],
        startPage: 5,
        maxPages: 3,
        pagesNeedingOcr: [5],
        pdfType: 'Mixed',
      }),
    ).toEqual([]);
  });

  it('EPUB only OCRs listed image pages, not empty text chapters', () => {
    expect(
      pagesNeedingOcrInWindow({
        pages: [
          { page: 1, text: '' },
          { page: 2, text: '' },
          { page: 3, text: 'chapter prose '.repeat(10) },
        ],
        startPage: 1,
        maxPages: 8,
        pagesNeedingOcr: [2],
        pdfType: null,
        docKind: 'epub',
      }),
    ).toEqual([2]);
  });

  it('PPTX OCRs listed image-only slides in the window', () => {
    expect(
      pagesNeedingOcrInWindow({
        pages: [
          { page: 1, text: 'Title slide with text '.repeat(5) },
          { page: 2, text: '' },
          { page: 3, text: '' },
        ],
        startPage: 1,
        maxPages: 8,
        pagesNeedingOcr: [2, 3],
        pdfType: null,
        docKind: 'pptx',
      }),
    ).toEqual([2, 3]);
  });

  it('PPTX image-only hint stubs should not block OCR', () => {
    const stub = '[image-only slide — use file_read for OCR]';
    expect(
      pagesNeedingOcrInWindow({
        pages: [
          { page: 1, text: 'Title slide with text '.repeat(5) },
          { page: 2, text: stub },
          { page: 3, text: stub },
        ],
        startPage: 1,
        maxPages: 8,
        pagesNeedingOcr: [2, 3],
        pdfType: null,
        docKind: 'pptx',
      }),
    ).toEqual([2, 3]);
  });
});
