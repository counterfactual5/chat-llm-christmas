import { describe, expect, it } from 'vitest';
import {
  parseExtractPages,
  sliceExtractForRead,
} from '@/lib/files/extract-slice';

const sample = [
  '--- page 1 ---',
  'Cover bitcoin intro',
  '',
  '--- page 2 ---',
  'Chapter one trading',
  '',
  '--- page 3 ---',
  'Chapter two wallets',
  '',
  '--- page 4 ---',
  'Chapter three risk',
].join('\n');

describe('extract-slice', () => {
  it('parses page markers', () => {
    const pages = parseExtractPages(sample);
    expect(pages).toHaveLength(4);
    expect(pages[0]).toMatchObject({ page: 1, text: 'Cover bitcoin intro' });
    expect(pages[3]?.page).toBe(4);
  });

  it('treats unmarked text as page 1', () => {
    const pages = parseExtractPages('hello plain');
    expect(pages).toEqual([{ page: 1, text: 'hello plain' }]);
  });

  it('slices a default overview window', () => {
    const slice = sliceExtractForRead(sample, { maxPages: 2 });
    expect(slice.startPage).toBe(1);
    expect(slice.endPage).toBe(2);
    expect(slice.totalPages).toBe(4);
    expect(slice.hasMore).toBe(true);
    expect(slice.text).toContain('--- page 1 ---');
    expect(slice.text).toContain('--- page 2 ---');
    expect(slice.text).not.toContain('Chapter three');
  });

  it('continues from start_page', () => {
    const slice = sliceExtractForRead(sample, { startPage: 3, maxPages: 2 });
    expect(slice.startPage).toBe(3);
    expect(slice.endPage).toBe(4);
    expect(slice.hasMore).toBe(false);
    expect(slice.text).toContain('wallets');
  });

  it('jumps near focus match', () => {
    const slice = sliceExtractForRead(sample, {
      focus: 'wallets',
      maxPages: 1,
    });
    expect(slice.matchedFocus).toBe(true);
    expect(slice.startPage).toBe(3);
    expect(slice.text).toContain('wallets');
  });
});
