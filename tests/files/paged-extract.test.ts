import { describe, expect, it } from 'vitest';
import {
  buildCatalogPage,
  formatPageMarker,
  serializePagedExtract,
} from '@/lib/files/paged-extract';

describe('paged-extract', () => {
  it('formats page markers', () => {
    expect(formatPageMarker(1)).toBe('--- page 1 ---');
    expect(formatPageMarker(3.9)).toBe('--- page 3 ---');
  });

  it('serializes units with optional titles', () => {
    const text = serializePagedExtract([
      { page: 2, title: 'b.md', body: 'hello' },
      { page: 1, body: '# Catalog\n\n1. b.md' },
    ]);
    expect(text).toContain('--- page 1 ---');
    expect(text).toContain('# Catalog');
    expect(text).toContain('--- page 2 ---');
    expect(text).toContain('## b.md');
    expect(text).toContain('hello');
    expect(text.indexOf('--- page 1 ---')).toBeLessThan(text.indexOf('--- page 2 ---'));
  });

  it('builds a catalog listing extracted and skipped entries', () => {
    const body = buildCatalogPage({
      title: 'ZIP catalog: demo.zip',
      entries: [
        { label: 'a.md', kind: 'text', sizeLabel: '12B', extractedPage: 2 },
        { label: 'pic.png', kind: 'image', note: 'image-only', extractedPage: 3 },
        { label: 'bin.exe', kind: 'other', skipped: 'unsupported' },
      ],
      footerNotes: ['[note: test]'],
    });
    expect(body).toContain('# ZIP catalog: demo.zip');
    expect(body).toContain('1. a.md · text · 12B · extracted → page 2');
    expect(body).toContain('2. pic.png · image · image-only · extracted → page 3');
    expect(body).toContain('3. bin.exe · other · skipped: unsupported');
    expect(body).toContain('[note: test]');
  });
});
