import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildXlsxBytes,
  parseSpreadsheetPreviewText,
  sheetsToExtractText,
} from '@/lib/files/spreadsheet';
import { parseCreateSpreadsheetArgs } from '@/lib/tools/create-spreadsheet/tool';

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
