/** Per-format text/data extraction for `ingestFile`. */

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  // Pin worker to the installed package version via CDN to avoid bundler path issues.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  const limit = Math.min(doc.numPages, 40);
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => item.str || '').join(' '));
  }
  if (doc.numPages > limit) {
    pages.push(`\n[…truncated: showing first ${limit} of ${doc.numPages} pages]`);
  }
  return pages.join('\n\n').trim();
}

export async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return String(result.value || '').trim();
}

const MAX_SPREADSHEET_SHEETS = 20;
const MAX_SPREADSHEET_ROWS_PER_SHEET = 2_000;

/** Extract .xlsx / .xls workbooks as TSV blocks (one section per sheet). */
export async function extractSpreadsheetText(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const names = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  if (!names.length) return '';

  const parts: string[] = [];
  const limit = Math.min(names.length, MAX_SPREADSHEET_SHEETS);
  for (let i = 0; i < limit; i++) {
    const sheetName = names[i];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    }) as unknown[][];
    if (!rows.length) continue;
    const clipped = rows.slice(0, MAX_SPREADSHEET_ROWS_PER_SHEET);
    const tsv = clipped
      .map((row) =>
        (Array.isArray(row) ? row : [])
          .map((cell) => String(cell ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' '))
          .join('\t'),
      )
      .join('\n')
      .trim();
    if (!tsv) continue;
    let block = `## Sheet: ${sheetName}\n\n${tsv}`;
    if (rows.length > MAX_SPREADSHEET_ROWS_PER_SHEET) {
      block += `\n\n[…truncated: showing first ${MAX_SPREADSHEET_ROWS_PER_SHEET} of ${rows.length} rows in this sheet]`;
    }
    parts.push(block);
  }
  if (names.length > MAX_SPREADSHEET_SHEETS) {
    parts.push(
      `[…truncated: showing first ${MAX_SPREADSHEET_SHEETS} of ${names.length} sheets]`,
    );
  }
  return parts.join('\n\n').trim();
}
