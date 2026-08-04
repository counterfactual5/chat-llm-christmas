import { describe, expect, it } from 'vitest';
import {
  findBodyStartPage,
  looksLikeTocPage,
  parseExtractPages,
  resolveAutoStartPage,
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

const withToc = [
  '--- page 1 ---',
  'Title page Bitcoin Guide',
  '',
  '--- page 2 ---',
  'Contents',
  'Chapter 1 .......... 5',
  'Chapter 2 .......... 12',
  'Chapter 3 .......... 20',
  'Chapter 4 .......... 28',
  'Appendix .......... 40',
  '',
  '--- page 3 ---',
  'Contents continued',
  'More chapter .......... 45',
  'Index .......... 50',
  'Notes .......... 55',
  'Glossary .......... 60',
  '',
  '--- page 4 ---',
  'Chapter 1 Getting started with bitcoin wallets and exchanges in practice. '.repeat(
    4,
  ),
  '',
  '--- page 5 ---',
  'Chapter 1 continued with more trading detail.',
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

  it('detects TOC pages via headings and dot leaders', () => {
    expect(
      looksLikeTocPage(
        'Contents\nA .......... 1\nB .......... 2\nC .......... 3\nD .......... 4',
      ),
    ).toBe(true);
    expect(
      looksLikeTocPage('Chapter one trading narrative without leaders'),
    ).toBe(false);
  });

  it('finds body start after TOC stretch', () => {
    const pages = parseExtractPages(withToc);
    expect(findBodyStartPage(pages)).toBe(4);
  });

  it('auto-starts from heuristic when start_page omitted', () => {
    const pages = parseExtractPages(withToc);
    const auto = resolveAutoStartPage({
      pages,
      startPageExplicit: false,
      startPage: 1,
    });
    expect(auto).toMatchObject({
      startPage: 4,
      skippedToc: true,
      source: 'heuristic',
    });
  });

  it('prefers outline body_start when in extracted range', () => {
    const pages = parseExtractPages(withToc);
    const auto = resolveAutoStartPage({
      pages,
      startPageExplicit: false,
      startPage: 1,
      outlineBodyStart: 5,
    });
    expect(auto).toMatchObject({
      startPage: 5,
      skippedToc: true,
      source: 'outline',
    });
  });

  it('keeps page 1 when start_page is explicit or focus is TOC', () => {
    const pages = parseExtractPages(withToc);
    expect(
      resolveAutoStartPage({
        pages,
        startPageExplicit: true,
        startPage: 1,
      }).startPage,
    ).toBe(1);
    expect(
      resolveAutoStartPage({
        pages,
        startPageExplicit: false,
        startPage: 1,
        focus: '目录',
      }).startPage,
    ).toBe(1);
  });
});
