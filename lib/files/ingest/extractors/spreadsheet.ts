import {
  buildCatalogPage,
  MAX_PAGED_CONTENT_UNITS,
  serializePagedExtract,
  type CatalogEntry,
} from '@/lib/files/paged-extract';

const MAX_SPREADSHEET_SHEETS = 20;
const MAX_SPREADSHEET_ROWS_PER_SHEET = 2_000;

/** Extract .xlsx / .xls as catalog (page 1) + one TSV page per sheet. */
export async function extractSpreadsheetText(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const names = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  if (!names.length) return '';

  const limit = Math.min(names.length, MAX_SPREADSHEET_SHEETS, MAX_PAGED_CONTENT_UNITS);
  const sheetBodies: Array<{ name: string; body: string }> = [];

  for (let i = 0; i < names.length; i++) {
    const sheetName = names[i]!;
    if (i >= limit) break;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      sheetBodies.push({ name: sheetName, body: '[empty sheet]' });
      continue;
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    }) as unknown[][];
    if (!rows.length) {
      sheetBodies.push({ name: sheetName, body: '[empty sheet]' });
      continue;
    }
    const clipped = rows.slice(0, MAX_SPREADSHEET_ROWS_PER_SHEET);
    let tsv = clipped
      .map((row) =>
        (Array.isArray(row) ? row : [])
          .map((cell) => String(cell ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' '))
          .join('\t'),
      )
      .join('\n')
      .trim();
    if (!tsv) tsv = '[empty sheet]';
    if (rows.length > MAX_SPREADSHEET_ROWS_PER_SHEET) {
      tsv += `\n\n[…truncated: showing first ${MAX_SPREADSHEET_ROWS_PER_SHEET} of ${rows.length} rows in this sheet]`;
    }
    sheetBodies.push({ name: sheetName, body: tsv });
  }

  const catalogEntries: CatalogEntry[] = names.map((sheetName, i) => {
    if (i < sheetBodies.length) {
      return {
        label: sheetName,
        kind: 'sheet',
        extractedPage: i + 2,
      };
    }
    return { label: sheetName, kind: 'sheet', skipped: 'extract limit' };
  });

  const footerNotes: string[] = [];
  if (names.length > sheetBodies.length) {
    footerNotes.push(
      `[note: extracted ${sheetBodies.length} of ${names.length} sheets into content pages]`,
    );
  }

  return serializePagedExtract([
    {
      page: 1,
      body: buildCatalogPage({
        title: `Excel sheets: ${file.name || 'workbook.xlsx'}`,
        entries: catalogEntries,
        footerNotes,
      }),
    },
    ...sheetBodies.map((s, i) => ({
      page: i + 2,
      title: `Sheet: ${s.name}`,
      body: s.body,
    })),
  ]);
}

