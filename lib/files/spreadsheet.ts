/**
 * Shared spreadsheet helpers: TSV extract text + xlsx bytes for ingest / tools / preview.
 */

import * as XLSX from 'xlsx';

export const SPREADSHEET_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Limits for model-created workbooks (stricter than upload extract). */
export const CREATE_SPREADSHEET_MAX_SHEETS = 10;
export const CREATE_SPREADSHEET_MAX_ROWS = 2_000;
export const CREATE_SPREADSHEET_MAX_COLS = 50;

/** Limits for preview table DOM. */
export const PREVIEW_TABLE_MAX_ROWS = 200;
export const PREVIEW_TABLE_MAX_COLS = 30;

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

export type ParsedSpreadsheetSection = {
  name: string;
  rows: string[][];
};

/** Parse extract / CSV / TSV text into preview sections. */
export function parseSpreadsheetPreviewText(text: string): ParsedSpreadsheetSection[] {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const sheetBlocks = raw.split(/^##\s*Sheet:\s*(.+)\s*$/gim);
  // split with capture: [before, name1, body1, name2, body2, ...]
  if (sheetBlocks.length >= 3) {
    const sections: ParsedSpreadsheetSection[] = [];
    for (let i = 1; i + 1 < sheetBlocks.length; i += 2) {
      const name = String(sheetBlocks[i] || '').trim() || `Sheet${sections.length + 1}`;
      const body = String(sheetBlocks[i + 1] || '').trim();
      const rows = parseDelimitedTable(body);
      if (rows.length) sections.push({ name, rows });
    }
    if (sections.length) return sections;
  }

  const rows = parseDelimitedTable(raw);
  return rows.length ? [{ name: 'Sheet1', rows }] : [];
}

function parseDelimitedTable(body: string): string[][] {
  const lines = String(body || '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !l.startsWith('[…truncated'));
  if (!lines.length) return [];

  const tabScore = lines.filter((l) => l.includes('\t')).length;
  const commaScore = lines.filter((l) => l.includes(',')).length;
  const delim = tabScore >= commaScore ? '\t' : ',';

  const rows = lines.slice(0, PREVIEW_TABLE_MAX_ROWS).map((line) => {
    if (delim === '\t') {
      return line.split('\t').slice(0, PREVIEW_TABLE_MAX_COLS).map((c) => c.trim());
    }
    return splitCsvLine(line).slice(0, PREVIEW_TABLE_MAX_COLS);
  });
  return rows;
}

/** Minimal CSV line split (handles simple quoted fields). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
