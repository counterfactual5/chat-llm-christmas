import { describe, expect, it } from 'vitest';
import { pagesNeedingOcrInWindow } from '@/lib/tools/file-read/tool';

describe('pagesNeedingOcrInWindow', () => {
  it('never OCRs TextBased', () => {
    expect(
      pagesNeedingOcrInWindow({
        pages: [{ page: 1, text: '' }],
        startPage: 1,
        maxPages: 8,
        pagesNeedingOcr: [1],
        needsOcr: true,
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
