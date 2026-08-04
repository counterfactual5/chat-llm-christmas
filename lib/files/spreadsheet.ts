/**
 * Shared spreadsheet helpers: TSV extract text + xlsx bytes for tools / views.
 * Text-only CSV/TSV preview parsing lives in `spreadsheet-text.ts` (no SheetJS).
 */

import * as XLSX from 'xlsx';

export {
  PREVIEW_TABLE_MAX_COLS,
  PREVIEW_TABLE_MAX_ROWS,
  parseSpreadsheetPreviewText,
  type ParsedSpreadsheetSection,
} from '@/lib/files/spreadsheet-text';
import type { ParsedSpreadsheetSection } from '@/lib/files/spreadsheet-text';

export const SPREADSHEET_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Limits for model-created workbooks (stricter than upload extract). */
export const CREATE_SPREADSHEET_MAX_SHEETS = 10;
export const CREATE_SPREADSHEET_MAX_ROWS = 2_000;
export const CREATE_SPREADSHEET_MAX_COLS = 50;

/** Limits for specialized `xlsx.table` view (stricter than ingest extract). */
export const VIEW_TABLE_MAX_ROWS = 500;
export const VIEW_TABLE_MAX_COLS = 30;

export type SpreadsheetSheetInput = {
  name: string;
  rows: unknown[][];
};

function cellToPlain(cell: unknown): string {
  if (cell == null) return '';
  if (typeof cell === 'number' && Number.isFinite(cell)) return String(cell);
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  return String(cell).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

export function sanitizeSheetName(raw: string, index: number): string {
  let name = String(raw || '')
    .replace(/[\\/?*[\]:]/g, '_')
    .trim()
    .slice(0, 31);
  if (!name) name = `Sheet${index + 1}`;
  return name;
}

export function normalizeSheetRows(
  rows: unknown,
  opts?: { maxRows?: number; maxCols?: number },
): unknown[][] {
  const maxRows = opts?.maxRows ?? CREATE_SPREADSHEET_MAX_ROWS;
  const maxCols = opts?.maxCols ?? CREATE_SPREADSHEET_MAX_COLS;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, maxRows).map((row) => {
    const cells = Array.isArray(row) ? row : [row];
    return cells.slice(0, maxCols);
  });
}

export function rowsToTsv(rows: unknown[][]): string {
  return rows
    .map((row) => (Array.isArray(row) ? row : []).map(cellToPlain).join('\t'))
    .join('\n')
    .trim();
}

/** Format sheets as `## Sheet: name` + TSV blocks (ingest / create_spreadsheet extract). */
export function sheetsToExtractText(
  sheets: SpreadsheetSheetInput[],
  opts?: { maxSheets?: number; maxRows?: number; maxCols?: number },
): string {
  const maxSheets = opts?.maxSheets ?? CREATE_SPREADSHEET_MAX_SHEETS;
  const list = sheets.slice(0, maxSheets);
  const parts: string[] = [];
  list.forEach((sheet, i) => {
    const name = sanitizeSheetName(sheet.name, i);
    const rows = normalizeSheetRows(sheet.rows, opts);
    const tsv = rowsToTsv(rows);
    if (!tsv) return;
    parts.push(`## Sheet: ${name}\n\n${tsv}`);
  });
  if (sheets.length > maxSheets) {
    parts.push(`[…truncated: showing first ${maxSheets} of ${sheets.length} sheets]`);
  }
  return parts.join('\n\n').trim();
}

/** Build .xlsx bytes from sheet rows. */
export function buildXlsxBytes(sheets: SpreadsheetSheetInput[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const list = sheets.length
    ? sheets.slice(0, CREATE_SPREADSHEET_MAX_SHEETS)
    : [{ name: 'Sheet1', rows: [] as unknown[][] }];

  list.forEach((sheet, i) => {
    let name = sanitizeSheetName(sheet.name, i);
    let n = 1;
    while (used.has(name.toLowerCase())) {
      const suffix = `_${n++}`;
      name = `${sanitizeSheetName(sheet.name, i).slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    }
    used.add(name.toLowerCase());
    const rows = normalizeSheetRows(sheet.rows);
    const aoa = rows.length ? rows : [['']];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

export type XlsxTableViewDataLike = {
  sheetName?: string;
  headers?: string[];
  rows: string[][];
};

/**
 * Normalize AOA / string[][] into `XlsxTableViewData`.
 * Default: treat first row as headers only when there are ≥2 rows.
 * Pass `firstRowAsHeaders: true` to force header promotion (even for a lone row).
 */
export function rowsToXlsxTableViewData(
  rows: unknown[][],
  opts?: {
    sheetName?: string;
    firstRowAsHeaders?: boolean;
    maxRows?: number;
    maxCols?: number;
  },
): XlsxTableViewDataLike {
  const maxRows = opts?.maxRows ?? VIEW_TABLE_MAX_ROWS;
  const maxCols = opts?.maxCols ?? VIEW_TABLE_MAX_COLS;
  const normalized = normalizeSheetRows(rows, { maxRows: maxRows + 1, maxCols }).map((row) =>
    (Array.isArray(row) ? row : []).map(cellToPlain),
  );
  if (!normalized.length) {
    return { sheetName: opts?.sheetName, rows: [] };
  }
  const useHeaders =
    opts?.firstRowAsHeaders === true ||
    (opts?.firstRowAsHeaders !== false && normalized.length > 1);
  if (useHeaders) {
    const headers = normalized[0].slice(0, maxCols);
    const body = normalized.slice(1, maxRows + 1);
    return {
      sheetName: opts?.sheetName,
      headers,
      rows: body,
    };
  }
  return {
    sheetName: opts?.sheetName,
    rows: normalized.slice(0, maxRows),
  };
}

/** Map a preview section (CSV/TSV extract) into view data. */
export function parsedSectionToXlsxTableViewData(
  section: ParsedSpreadsheetSection,
  opts?: { firstRowAsHeaders?: boolean; maxRows?: number; maxCols?: number },
): XlsxTableViewDataLike {
  return rowsToXlsxTableViewData(section.rows, {
    sheetName: section.name,
    firstRowAsHeaders: opts?.firstRowAsHeaders,
    maxRows: opts?.maxRows,
    maxCols: opts?.maxCols,
  });
}

/**
 * Read one sheet from workbook bytes into `XlsxTableViewData`.
 * `sheet` may be a name or 0-based index string; default first sheet.
 */
export function workbookBytesToXlsxTableViewData(
  bytes: ArrayBuffer | Uint8Array,
  opts?: {
    sheet?: string;
    firstRowAsHeaders?: boolean;
    maxRows?: number;
    maxCols?: number;
  },
): XlsxTableViewDataLike & { sheetNames: string[] } {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  const names = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
  if (!names.length) {
    return { rows: [], sheetNames: [] };
  }

  const requested = String(opts?.sheet || '').trim();
  let sheetName = names[0];
  if (requested) {
    const byName = names.find((n) => n.toLowerCase() === requested.toLowerCase());
    if (byName) {
      sheetName = byName;
    } else if (/^\d+$/.test(requested)) {
      const idx = Number(requested);
      if (idx >= 0 && idx < names.length) sheetName = names[idx];
    }
  }

  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];

  return {
    ...rowsToXlsxTableViewData(aoa, {
      sheetName,
      firstRowAsHeaders: opts?.firstRowAsHeaders,
      maxRows: opts?.maxRows,
      maxCols: opts?.maxCols,
    }),
    sheetNames: names,
  };
}
