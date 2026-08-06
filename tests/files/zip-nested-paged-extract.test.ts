import { describe, expect, it } from 'vitest';
import { parseExtractPages } from '@/lib/files/extract-slice';
import { serializePagedExtract } from '@/lib/files/paged-extract';
import { collapseNestedPagedExtractMarkers } from '@/lib/files/ingest/extractors';

describe('collapseNestedPagedExtractMarkers', () => {
  it('collapses nested --- page N --- markers from a serialized paged-extract payload', () => {
    const nested = serializePagedExtract([
      { page: 1, body: '# inner catalog\n\n1. inner' },
      { page: 2, body: 'nested content A' },
      { page: 3, body: 'nested content B' },
    ]);

    // Bug reproduction (without collapsing): outer parse would treat nested markers as pages.
    const outerWrong = serializePagedExtract([
      { page: 1, body: '# ZIP catalog: bundle.zip' },
      { page: 2, title: 'inner/report.docx', body: nested },
    ]);
    const wrongPages = parseExtractPages(outerWrong);
    expect(wrongPages.map((p) => p.page)).toContain(3);

    // Fix: collapse nested markers before embedding as a member body.
    const collapsed = collapseNestedPagedExtractMarkers(nested);
    const outerRight = serializePagedExtract([
      { page: 1, body: '# ZIP catalog: bundle.zip' },
      { page: 2, title: 'inner/report.docx', body: collapsed },
    ]);
    const rightPages = parseExtractPages(outerRight);

    expect(rightPages.map((p) => p.page)).toEqual([1, 2]);
    expect(outerRight).not.toContain('--- page 3 ---');
  });

  it('does not strip literal --- page N --- lines when payload is not a serialized paged-extract', () => {
    const nonPaged = [
      'random member text (not a serialized paged-extract)',
      '--- page 99 ---',
      'this line should remain verbatim',
    ].join('\n');

    const collapsed = collapseNestedPagedExtractMarkers(nonPaged);
    expect(collapsed).toContain('--- page 99 ---');
  });
});

