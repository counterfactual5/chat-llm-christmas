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

import { extractPdfText } from './pdf';
import { extractDocxText } from './docx';
import { extractEpubTextFromBytes } from './epub';
import { extractPptxTextFromBytes } from './pptx';
import { extractSpreadsheetText } from './spreadsheet';

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
  const base = path.split('/').filter(Boolean).pop() || path;
  switch (kind) {
    case 'pdf':
      return extractPdfText(fileFromBytes(base, bytes, 'application/pdf'));
    case 'epub':
      return extractEpubTextFromBytes(bytes);
    case 'docx':
      return extractDocxText(
        fileFromBytes(
          base,
          bytes,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      );
    case 'pptx':
      return extractPptxTextFromBytes(bytes);
    case 'xlsx':
    case 'xls':
      return extractSpreadsheetText(
        fileFromBytes(
          base,
          bytes,
          kind === 'xls'
            ? 'application/vnd.ms-excel'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    const lower = path.toLowerCase();

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
      const isLegacyOle = /\.(doc|ppt)$/i.test(lower);
      catalogEntries.push({
        label: path,
        kind: isLegacyOle ? 'ole' : 'other',
        sizeLabel: size ? formatByteSize(size) : undefined,
        skipped: isLegacyOle
          ? 'legacy OLE — save as .docx / .pptx to extract'
          : 'unsupported',
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

      // If the member is an embedded Office-like paged-extract, collapse
      // its nested `--- page N ---` markers so the outer slice parser
      // won't treat them as real pages.
      if (
        kind === 'docx' ||
        kind === 'pptx' ||
        kind === 'xlsx' ||
        kind === 'xls'
      ) {
        body = collapseNestedPagedExtractMarkers(body);
      }
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

