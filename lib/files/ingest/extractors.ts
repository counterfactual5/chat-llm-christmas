/** Per-format text/data extraction for `ingestFile`. */

import {
  buildCatalogPage,
  formatByteSize,
  MAX_PAGED_CONTENT_UNITS,
  MAX_ZIP_LISTED_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  serializePagedExtract,
  type CatalogEntry,
  type PagedExtractUnit,
} from '@/lib/files/paged-extract';
import {
  shouldSkipZipMemberPath,
  zipMemberExtractKind,
} from '@/lib/files/ingest/support';

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
  const htmlResult = await mammoth.convertToHtml({ arrayBuffer: buffer });
  const html = String(htmlResult.value || '').trim();
  const fromHtml = docxPagedExtractFromHtml(html, file.name || 'document.docx');
  if (fromHtml) return fromHtml;

  const raw = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = String(raw.value || '').trim();
  const hasImage = /<img\b/i.test(html);
  if (!text && !hasImage) return '';
  return serializePagedExtract([
    {
      page: 1,
      body: buildCatalogPage({
        title: `DOCX outline: ${file.name || 'document.docx'}`,
        entries: [
          {
            label: '(document body)',
            kind: 'section',
            note: hasImage ? (text ? 'has image' : 'image-only') : undefined,
            extractedPage: 2,
          },
        ],
      }),
    },
    {
      page: 2,
      title: 'Document',
      body: text || '[image-only document — use file_read for OCR]',
    },
  ]);
}

/** Build paged DOCX extract from mammoth HTML (exported for tests). */
export function docxPagedExtractFromHtml(html: string, filename = 'document.docx'): string {
  const sections = sectionsFromMammothHtml(html);
  if (
    !(
      sections.length > 1 ||
      (sections.length === 1 && (sections[0]!.title || sections[0]!.hasImage))
    )
  ) {
    return '';
  }
  const limited = sections.slice(0, MAX_PAGED_CONTENT_UNITS);
  const catalogEntries: CatalogEntry[] = sections.map((s, i) => {
    const label = s.title || `(section ${i + 1})`;
    const note = s.hasImage
      ? s.body.trim()
        ? 'has image'
        : 'image-only'
      : undefined;
    if (i < limited.length) {
      return {
        label,
        kind: 'section',
        note,
        extractedPage: i + 2,
      };
    }
    return { label, kind: 'section', note, skipped: 'extract limit' };
  });
  const footerNotes: string[] = [];
  if (sections.length > limited.length) {
    footerNotes.push(
      `[note: extracted ${limited.length} of ${sections.length} sections into content pages]`,
    );
  }
  return serializePagedExtract([
    {
      page: 1,
      body: buildCatalogPage({
        title: `DOCX outline: ${filename}`,
        entries: catalogEntries,
        footerNotes,
      }),
    },
    ...limited.map((s, i) => ({
      page: i + 2,
      title: s.title || `Section ${i + 1}`,
      body: s.body.trim()
        ? s.body
        : s.hasImage
          ? '[image-only section — use file_read for OCR]'
          : '[empty section]',
    })),
  ]);
}

/** Split mammoth HTML on h1/h2 into titled sections (ingest-local; mirrors docx_extract). */
function sectionsFromMammothHtml(
  html: string,
): Array<{ title?: string; body: string; hasImage: boolean }> {
  const source = String(html || '').trim();
  if (!source) return [];

  const stripTags = (s: string) =>
    String(s || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

  const fragmentHasImage = (fragment: string) => /<img\b/i.test(fragment);

  const htmlToPlain = (fragment: string) => {
    let s = String(fragment || '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/p>/gi, '\n\n');
    s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `- ${stripTags(inner)}\n`);
    s = s.replace(/<[^>]+>/g, ' ');
    s = s
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return s;
  };

  const parts = source.split(/(?=<h[12]\b)/i).filter((p) => p.trim());
  if (parts.length <= 1) {
    const body = htmlToPlain(source);
    const hasImage = fragmentHasImage(source);
    return body || hasImage ? [{ body, hasImage }] : [];
  }

  const sections: Array<{ title?: string; body: string; hasImage: boolean }> = [];
  for (const part of parts) {
    const headingMatch = part.match(/^<h([12])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (headingMatch) {
      const title = stripTags(headingMatch[2]) || undefined;
      const rest = part.slice(headingMatch[0].length);
      const body = htmlToPlain(rest);
      sections.push({ title, body: body || '', hasImage: fragmentHasImage(rest) });
    } else {
      const body = htmlToPlain(part);
      const hasImage = fragmentHasImage(part);
      if (body || hasImage) sections.push({ body, hasImage });
    }
  }
  return sections;
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

function slideTitleFromBody(body: string, slideNum: number, hasImage: boolean): string {
  const first = String(body || '')
    .split(/\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) {
    return hasImage ? `Slide ${slideNum} (image-only)` : `Slide ${slideNum}`;
  }
  const clipped = first.slice(0, 80);
  return clipped.length < first.length ? `${clipped}…` : clipped;
}

function pptxSlideHasImage(xml: string): boolean {
  // DrawingML blip / picture shape — enough to flag without decoding media.
  return /<a:blip\b/i.test(xml) || /<p:pic\b/i.test(xml) || /<asvg:svgBlip\b/i.test(xml);
}

/**
 * Extract .pptx as catalog (page 1) + one unit per slide (page 2..).
 * Image-only slides: catalog notes "image-only"; body stub — OCR via file_read later.
 */
export async function extractPptxTextFromBytes(
  data: Uint8Array,
  opts?: { filename?: string },
): Promise<string> {
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

  const limit = Math.min(slideEntries.length, MAX_PPTX_SLIDES, MAX_PAGED_CONTENT_UNITS);
  const slides: Array<{
    num: number;
    title: string;
    body: string;
    hasImage: boolean;
  }> = [];
  for (let i = 0; i < slideEntries.length; i++) {
    if (i >= limit) break;
    const { path, num } = slideEntries[i]!;
    const xml = await zip.files[path]!.async('string');
    const hasImage = pptxSlideHasImage(xml);
    let body = textFromPptxXml(xml);
    const notesPath = `ppt/notesSlides/notesSlide${num}.xml`;
    if (zip.files[notesPath]) {
      const notes = textFromPptxXml(await zip.files[notesPath]!.async('string'));
      if (notes) body = body ? `${body}\n\n[notes] ${notes}` : `[notes] ${notes}`;
    }
    const textBody = body.trim();
    slides.push({
      num,
      title: slideTitleFromBody(textBody, num, hasImage),
      body: textBody
        ? body
        : hasImage
          ? '[image-only slide — use file_read for OCR]'
          : '',
      hasImage,
    });
  }

  const catalogEntries: CatalogEntry[] = slideEntries.map((e, i) => {
    if (i < slides.length) {
      const s = slides[i]!;
      const note = s.hasImage
        ? s.body.startsWith('[image-only')
          ? 'image-only'
          : 'has image'
        : undefined;
      return {
        label: `Slide ${e.num}: ${s.title}`,
        kind: 'slide',
        note,
        extractedPage: i + 2,
      };
    }
    return {
      label: `Slide ${e.num}`,
      kind: 'slide',
      skipped: 'extract limit',
    };
  });
  const footerNotes: string[] = [];
  if (slideEntries.length > slides.length) {
    footerNotes.push(
      `[note: extracted ${slides.length} of ${slideEntries.length} slides into content pages]`,
    );
  }

  const name = String(opts?.filename || 'deck.pptx').trim() || 'deck.pptx';
  const units: PagedExtractUnit[] = [
    {
      page: 1,
      body: buildCatalogPage({
        title: `PPTX outline: ${name}`,
        entries: catalogEntries,
        footerNotes,
      }),
    },
    ...slides.map((s, i) => ({
      page: i + 2,
      title: `Slide ${s.num}: ${s.title}`,
      body: s.body || '[empty slide]',
    })),
  ];
  const out = serializePagedExtract(units);
  if (out) return out;
  return `[PPTX with ${slideEntries.length} slides; no extractable text layer]`;
}

export async function extractPptxText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  return extractPptxTextFromBytes(data, { filename: file.name || 'deck.pptx' });
}

function fileFromBytes(name: string, bytes: Uint8Array, mime?: string): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: mime || 'application/octet-stream' });
}

/**
 * When a ZIP member contains another serialized paged-extract (which itself
 * uses `--- page N ---` blocks), we must not embed those markers verbatim;
 * otherwise the outer `parseExtractPages` will treat nested markers as real
 * pages and corrupt slicing.
 */
export function collapseNestedPagedExtractMarkers(raw: string): string {
  const src = String(raw || '').trim();
  if (!src) return '';
  // Only collapse when it looks like our own serialized paged-extract format.
  // This avoids accidentally stripping literal content lines that merely match
  // `--- page N ---` but are not part of a paged extract sidecar.
  const looksLikeSerializedPagedExtract =
    src.startsWith('--- page 1 ---') && /(?:^|\n)--- page 2 ---/.test(src);
  if (!looksLikeSerializedPagedExtract) return src;

  const blocks = src
    .split(/^--- page \d+ ---$/gm)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.join('\n\n').trim();
}

async function extractZipMemberText(
  kind: ReturnType<typeof zipMemberExtractKind>,
  path: string,
  bytes: Uint8Array,
): Promise<string> {
  // ZIP “members” are already placed into an outer `--- page N ---` window.
  // If we embed another paged-extract (with `--- page N ---` markers) as a member
  // body, the outer `parseExtractPages` will treat those nested markers as real pages.
  // So we collapse nested paged-extract to plain text (remove markers).

  const base = path.split('/').filter(Boolean).pop() || path;
  switch (kind) {
    case 'pdf':
      return extractPdfText(fileFromBytes(base, bytes, 'application/pdf'));
    case 'docx':
      return collapseNestedPagedExtractMarkers(
        await extractDocxText(
          fileFromBytes(
            base,
            bytes,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ),
        ),
      );
    case 'pptx':
      return collapseNestedPagedExtractMarkers(await extractPptxTextFromBytes(bytes));
    case 'xlsx':
    case 'xls':
      return collapseNestedPagedExtractMarkers(
        await extractSpreadsheetText(
          fileFromBytes(
            base,
            bytes,
            kind === 'xls'
              ? 'application/vnd.ms-excel'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ),
        ),
      );
    case 'text': {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      return String(text || '').trim();
    }
    case 'image':
      return `[image-only — use file_read / re-attach for vision; ${base} · ${formatByteSize(bytes.byteLength)}]`;
    default:
      return '';
  }
}

/**
 * ZIP → paged extract: page 1 = full catalog; page 2.. = whitelisted member bodies
 * (≤ MAX_PAGED_CONTENT_UNITS). Nested zip / unsupported listed as skipped.
 */
export async function extractZipTextFromBytes(
  data: Uint8Array,
  opts?: { archiveName?: string },
): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const archiveName = String(opts?.archiveName || 'archive.zip').trim() || 'archive.zip';

  const allPaths = Object.keys(zip.files).sort((a, b) => a.localeCompare(b));
  const catalogEntries: CatalogEntry[] = [];
  const contentUnits: PagedExtractUnit[] = [];
  const footerNotes: string[] = [];

  let listed = 0;
  let uncompressed = 0;
  let extractableCount = 0;
  let stoppedListing = false;
  let stoppedExtract = false;

  for (const rawPath of allPaths) {
    const entry = zip.files[rawPath];
    if (!entry || entry.dir) continue;
    if (shouldSkipZipMemberPath(rawPath)) continue;

    listed += 1;
    if (listed > MAX_ZIP_LISTED_ENTRIES) {
      stoppedListing = true;
      break;
    }

    const path = rawPath.replace(/\\/g, '/');
    const kind = zipMemberExtractKind(path);
    let size = 0;
    // JSZip 的 _data.uncompressedSize 在部分情况下可能缺失/不可信。
    // 安全策略：缺失时直接 fail-closed，避免在解压前失去上限控制。
    let missingUncompressedSize = false;
    try {
      // _data.uncompressedSize is present on many JSZip entries; fall back after load.
      const meta = entry as { _data?: { uncompressedSize?: number } };
      const u = meta._data?.uncompressedSize;
      const n = Number(u);
      if (!Number.isFinite(n) || n <= 0) {
        missingUncompressedSize = true;
        size = 0;
      } else {
        size = n;
      }
    } catch {
      missingUncompressedSize = true;
      size = 0;
    }

    if (kind === 'nested_zip') {
      catalogEntries.push({
        label: path,
        kind: 'zip',
        sizeLabel: size ? formatByteSize(size) : undefined,
        skipped: 'nested archive',
      });
      continue;
    }
    if (kind === 'skip') {
      catalogEntries.push({
        label: path,
        kind: 'other',
        sizeLabel: size ? formatByteSize(size) : undefined,
        skipped: 'unsupported',
      });
      continue;
    }

    extractableCount += 1;

    const wouldOverflow =
      missingUncompressedSize ||
      (size > 0 && uncompressed + size > MAX_ZIP_UNCOMPRESSED_BYTES);
    if (
      contentUnits.length >= MAX_PAGED_CONTENT_UNITS ||
      stoppedExtract ||
      uncompressed >= MAX_ZIP_UNCOMPRESSED_BYTES ||
      wouldOverflow
    ) {
      catalogEntries.push({
        label: path,
        kind,
        sizeLabel: size ? formatByteSize(size) : undefined,
        skipped:
          contentUnits.length >= MAX_PAGED_CONTENT_UNITS
            ? 'extract limit'
            : 'uncompressed size limit',
      });
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await entry.async('uint8array');
    } catch {
      catalogEntries.push({
        label: path,
        kind,
        skipped: 'read failed',
      });
      continue;
    }
    size = bytes.byteLength;
    uncompressed += size;
    if (uncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      stoppedExtract = true;
      catalogEntries.push({
        label: path,
        kind,
        sizeLabel: formatByteSize(size),
        skipped: 'uncompressed size limit',
      });
      continue;
    }

    const page = contentUnits.length + 2; // page 1 = catalog
    let body = '';
    try {
      body = await extractZipMemberText(kind, path, bytes);
    } catch (err) {
      body = `[extract failed: ${err instanceof Error ? err.message : 'error'}]`;
    }
    if (!body.trim() && kind !== 'image') {
      body = `[no extractable text: ${path}]`;
    }
    contentUnits.push({ page, title: path, body });
    catalogEntries.push({
      label: path,
      kind,
      sizeLabel: formatByteSize(size),
      note: kind === 'image' ? 'image-only' : undefined,
      extractedPage: page,
    });
  }

  if (stoppedListing) {
    footerNotes.push(
      `[…listing truncated: showing first ${MAX_ZIP_LISTED_ENTRIES} file entries]`,
    );
  }
  if (extractableCount > contentUnits.length) {
    footerNotes.push(
      `[note: extracted ${contentUnits.length} of ${extractableCount} supported members into content pages; others listed above as skipped]`,
    );
  }
  if (stoppedExtract || uncompressed >= MAX_ZIP_UNCOMPRESSED_BYTES) {
    footerNotes.push(
      `[note: stopped member extract after ~${formatByteSize(Math.min(uncompressed, MAX_ZIP_UNCOMPRESSED_BYTES))} uncompressed]`,
    );
  }

  const catalogBody = buildCatalogPage({
    title: `ZIP catalog: ${archiveName}`,
    entries: catalogEntries,
    footerNotes,
  });

  return serializePagedExtract([
    { page: 1, body: catalogBody },
    ...contentUnits,
  ]);
}

export async function extractZipText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  return extractZipTextFromBytes(data, { archiveName: file.name || 'archive.zip' });
}

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
