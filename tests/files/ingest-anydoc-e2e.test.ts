/**
 * E2E check that the anydoc-wasm path produces a valid paged extract for real
 * fixture files. Runs in vitest so webpack alias + asset pipeline mirror prod.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ingestFile } from '@/lib/files/ingest';

const FIXTURES = `${process.cwd()}/tests/files/fixtures`;

function loadFile(name: string, type: string): File {
  const bytes = readFileSync(`${FIXTURES}/${name}`);
  return new File([bytes], name, { type });
}

describe('ingestFile DOCX via anydoc', () => {
  it('produces a paged extract with markdown table content', async () => {
    const file = loadFile(
      'tables.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const result = await ingestFile(file);
    expect(result.name).toBe('tables.docx');
    const text = String(result.text || '');
    // Paged-extract markers
    expect(text).toContain('--- page 1 ---');
    // Catalog title mentions anydoc so we know which pipeline ran
    expect(text).toContain('anydoc');
    // Body is the document's markdown
    expect(text).toContain('| Top left | Top right |');
    expect(text).toContain('| --- | --- |');
    expect(text).toContain('| Bottom left | Bottom right |');
  }, 30_000);
});

describe('ingestFile EPUB via anydoc', () => {
  it('produces a catalog-first paged extract with chapter + table markdown', async () => {
    const file = loadFile('book.epub', 'application/epub+zip');
    const result = await ingestFile(file);
    expect(result.name).toBe('book.epub');
    const text = String(result.text || '');
    expect(text).toContain('--- page 1 ---');
    expect(text).toContain('book.epub (anydoc)');
    // EPUB keeps chapter headings
    expect(text).toContain('# Chapter One');
    expect(text).toContain('# Chapter Two');
    // EPUB tables render as GFM
    expect(text).toContain('| Name | Qty |');
    expect(text).toContain('| --- | --- |');
    expect(text).toContain('| Bolts | 12 |');
    // Anchors retained by anydoc
    expect(text).toContain('epub-text-ch001-xhtml-chapter-one');
  }, 30_000);
});

describe('ingestFile PPTX via anydoc', () => {
  it('produces a catalog-first paged extract with markdown table + speaker notes', async () => {
    const file = loadFile(
      'pres.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    const result = await ingestFile(file);
    expect(result.name).toBe('pres.pptx');
    const text = String(result.text || '');
    expect(text).toContain('--- page 1 ---');
    expect(text).toContain('pres.pptx (anydoc)');
    expect(text).toContain('Deck Title Slide');
    // Table in second slide renders as GFM
    expect(text).toContain('| Region | Total |');
    expect(text).toContain('| --- | --- |');
    expect(text).toContain('| North | 42 |');
    // Speaker notes surface as blockquotes in anydoc's markdown
    expect(text).toMatch(/>\s*Speaker note/);
  }, 30_000);
});

