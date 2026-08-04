/**
 * CSV / TSV / extract-text parsing for spreadsheet preview — no SheetJS.
 * Keep this free of `xlsx` so client preview UI does not pull the workbook lib.
 */

/** Limits for preview table DOM. */
export const PREVIEW_TABLE_MAX_ROWS = 200;
export const PREVIEW_TABLE_MAX_COLS = 30;

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
