/** Per-format text/data extraction for `ingestFile`. */

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

const PDF_PAGE_LIMIT = 40;

/**
 * Server-safe PDF text extract (file_read / ensure sidecar).
 * Do not use pdfjs-dist here — it expects DOM/canvas and throws
 * `Cannot read properties of undefined (reading 'prototype')` on Vercel Node.
 */
export async function extractPdfTextFromBytes(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(data);
  const pageCount = Number(pdf.numPages) || 0;
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  let body = String(text || '').trim();
  if (!body) return '';
  // Soft page hint when the library reported more pages than we typically show
  // in the browser ingest path (full text still returned; file_read truncates).
  const pages = totalPages || pageCount;
  if (pages > PDF_PAGE_LIMIT) {
    body += `\n\n[…document has ${pages} pages; extract may be long]`;
  }
  return body;
}

export async function extractPdfText(file: File): Promise<string> {
  // Browser ingest: pdfjs + CDN worker (DOM available).
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  const limit = Math.min(doc.numPages, PDF_PAGE_LIMIT);
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

/** Strip tags from EPUB XHTML/HTML spine documents (best-effort plain text). */
export async function extractEpubTextFromBytes(data: Uint8Array): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const parts: string[] = [];
  const names = Object.keys(zip.files)
    .filter((n) => /\.(x?html?|xml)$/i.test(n) && !/META-INF/i.test(n))
    .sort();
  const limit = Math.min(names.length, 80);
  for (let i = 0; i < limit; i++) {
    const raw = await zip.files[names[i]]!.async('string');
    const text = String(raw || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 40) parts.push(text);
  }
  if (names.length > limit) {
    parts.push(`[…truncated: showing first ${limit} of ${names.length} EPUB documents]`);
  }
  return parts.join('\n\n').trim();
}

export async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return String(result.value || '').trim();
}

const MAX_PPTX_SLIDES = 80;

function decodeXmlEntities(raw: string): string {
  return String(raw || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const code = Number.parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

/** Pull plain text runs from a PPTX slide/notes XML fragment. */
function textFromPptxXml(xml: string): string {
  const parts: string[] = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const t = decodeXmlEntities(m[1]).replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract .pptx as page-marked text (`--- page N ---` per slide) for ingest /
 * file_read. Image-only slides become empty page bodies (OCR via file_read later).
 */
export async function extractPptxTextFromBytes(data: Uint8Array): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const slideEntries = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .map((path) => {
      const num = Number(/slide(\d+)\.xml$/i.exec(path)?.[1] || 0);
      return { path, num };
    })
    .filter((e) => e.num > 0)
    .sort((a, b) => a.num - b.num);

  if (!slideEntries.length) return '';

  const limit = Math.min(slideEntries.length, MAX_PPTX_SLIDES);
  const parts: string[] = [];
  for (let i = 0; i < limit; i++) {
    const { path, num } = slideEntries[i]!;
    const xml = await zip.files[path]!.async('string');
    let body = textFromPptxXml(xml);
    const notesPath = `ppt/notesSlides/notesSlide${num}.xml`;
    if (zip.files[notesPath]) {
      const notes = textFromPptxXml(await zip.files[notesPath]!.async('string'));
      if (notes) body = body ? `${body}\n\n[notes] ${notes}` : `[notes] ${notes}`;
    }
    parts.push(`--- page ${num} ---\n${body}`.trimEnd());
  }
  if (slideEntries.length > limit) {
    parts.push(
      `[…truncated: showing first ${limit} of ${slideEntries.length} slides]`,
    );
  }
  const out = parts.join('\n\n').trim();
  if (out) return out;
  return `[PPTX with ${slideEntries.length} slides; no extractable text layer]`;
}

export async function extractPptxText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  return extractPptxTextFromBytes(data);
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
