import { describe, expect, it } from 'vitest';
import { pagesNeedingOcrInWindow } from '@/lib/tools/file-read/tool';

describe('pagesNeedingOcrInWindow', () => {
  it('OCRs known-empty TextBased pages (整本误判兜底)', () => {
    expect(
      pagesNeedingOcrInWindow({
        pages: [
          { page: 1, text: '' },
          { page: 2, text: 'normal chapter text '.repeat(10) },
        ],
        startPage: 1,
        maxPages: 8,
        pagesNeedingOcr: [],
        needsOcr: false,
        pdfType: 'TextBased',
      }),
    ).toEqual([1]);
  });

  it('does not OCR TextBased pages not yet in the extract', () => {
    expect(
      pagesNeedingOcrInWindow({
        pages: [{ page: 2, text: 'body '.repeat(20) }],
        startPage: 1,
        maxPages: 3,
        pagesNeedingOcr: [],
        needsOcr: false,
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
        needsOcr: true,
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
        needsOcr: true,
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
        needsOcr: true,
        pdfType: 'Mixed',
      }),
    ).toEqual([]);
  });
});
