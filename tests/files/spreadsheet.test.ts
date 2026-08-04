import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildXlsxBytes,
  parseSpreadsheetPreviewText,
  rowsToXlsxTableViewData,
  sheetsToExtractText,
  workbookBytesToXlsxTableViewData,
} from '@/lib/files/spreadsheet';
import { parseCreateSpreadsheetArgs } from '@/lib/tools/create-spreadsheet/tool';
import { parseXlsxExtractArgs } from '@/lib/tools/xlsx-extract/tool';
import {
  commentsFromCommentsXml,
  outlineFromDocxHtml,
  parseDocxExtractArgs,
  sectionsFromDocxHtml,
} from '@/lib/tools/docx-extract/tool';

describe('sheetsToExtractText / buildXlsxBytes', () => {
  it('formats multi-sheet TSV extract and builds a readable workbook', () => {
    const sheets = [
      {
        name: 'Sales',
        rows: [
          ['Item', 'Qty'],
          ['Apple', 3],
          ['Pear', 2],
        ],
      },
      { name: 'Notes', rows: [['hello', 'world']] },
    ];
    const extract = sheetsToExtractText(sheets);
    expect(extract).toContain('## Sheet: Sales');
    expect(extract).toContain('Item\tQty');
    expect(extract).toContain('Apple\t3');
    expect(extract).toContain('## Sheet: Notes');

    const bytes = buildXlsxBytes(sheets);
    expect(bytes.byteLength).toBeGreaterThan(100);
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['Sales', 'Notes']);
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Sales, { header: 1 })).toEqual([
      ['Item', 'Qty'],
      ['Apple', 3],
      ['Pear', 2],
    ]);
  });
});

describe('parseSpreadsheetPreviewText', () => {
  it('parses ## Sheet blocks and plain CSV/TSV', () => {
    const multi = parseSpreadsheetPreviewText(
      '## Sheet: A\n\nname\tval\nx\t1\n\n## Sheet: B\n\na,b\n1,2',
    );
    expect(multi).toHaveLength(2);
    expect(multi[0]).toEqual({ name: 'A', rows: [['name', 'val'], ['x', '1']] });
    expect(multi[1].name).toBe('B');
    expect(multi[1].rows[0]).toEqual(['a', 'b']);

    const csv = parseSpreadsheetPreviewText('a,b\n1,2');
    expect(csv).toEqual([{ name: 'Sheet1', rows: [['a', 'b'], ['1', '2']] }]);
  });
});

describe('rowsToXlsxTableViewData / workbookBytesToXlsxTableViewData', () => {
  it('uses first row as headers by default when there are ≥2 rows', () => {
    const table = rowsToXlsxTableViewData(
      [
        ['A', 'B'],
        [1, 2],
        [3, 4],
      ],
      { sheetName: 'S1' },
    );
    expect(table).toEqual({
      sheetName: 'S1',
      headers: ['A', 'B'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    });
  });

  it('keeps a single row as body data (not an empty header-only table)', () => {
    expect(rowsToXlsxTableViewData([['only', 'row']], { sheetName: 'S1' })).toEqual({
      sheetName: 'S1',
      rows: [['only', 'row']],
    });
  });

  it('reads a sheet from workbook bytes by name', () => {
    const bytes = buildXlsxBytes([
      {
        name: 'Sales',
        rows: [
          ['Item', 'Qty'],
          ['Apple', 3],
        ],
      },
      { name: 'Notes', rows: [['x', 'y']] },
    ]);
    const table = workbookBytesToXlsxTableViewData(bytes, { sheet: 'Sales' });
    expect(table.sheetName).toBe('Sales');
    expect(table.headers).toEqual(['Item', 'Qty']);
    expect(table.rows).toEqual([['Apple', '3']]);
    expect(table.sheetNames).toEqual(['Sales', 'Notes']);
  });
});

describe('parseCreateSpreadsheetArgs', () => {
  it('normalizes filename and sheets; rejects empty rows', () => {
    const ok = parseCreateSpreadsheetArgs(
      JSON.stringify({
        filename: 'report',
        sheets: [{ name: 'S1', rows: [['a', 1]] }],
      }),
    );
    expect(ok.error).toBeUndefined();
    expect(ok.filename).toBe('report.xlsx');
    expect(ok.sheets[0].rows).toEqual([['a', 1]]);

    const bad = parseCreateSpreadsheetArgs(JSON.stringify({ sheets: [{ name: 'S1', rows: [] }] }));
    expect(bad.error).toMatch(/requires sheets/);
  });
});

describe('parseXlsxExtractArgs', () => {
  it('reads file_id and optional sheet', () => {
    expect(
      parseXlsxExtractArgs(JSON.stringify({ file_id: 'file_abc', sheet: 'Sales' }), ''),
    ).toEqual({ fileId: 'file_abc', sheet: 'Sales' });
  });
});

describe('docx_extract helpers', () => {
  it('parses mode and builds outline / sections / comments', () => {
    expect(parseDocxExtractArgs(JSON.stringify({ file_id: 'f1', mode: 'outline' }), '')).toEqual({
      fileId: 'f1',
      mode: 'outline',
    });

    const html = '<h1>Title</h1><p>Intro</p><h2>Sub</h2><p>Body</p>';
    expect(outlineFromDocxHtml(html)).toEqual([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Sub' },
    ]);
    expect(sectionsFromDocxHtml(html)[0]?.title).toBe('Title');

    const xml = `
      <w:comments>
        <w:comment w:id="0" w:author="Ada" w:date="2024-01-01T00:00:00Z">
          <w:p><w:r><w:t>Hello</w:t></w:r></w:p>
        </w:comment>
      </w:comments>`;
    expect(commentsFromCommentsXml(xml)).toEqual([
      { id: '0', author: 'Ada', date: '2024-01-01T00:00:00Z', body: 'Hello' },
    ]);
  });
});
