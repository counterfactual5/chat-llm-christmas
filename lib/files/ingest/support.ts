export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const ZIP_MIME = 'application/zip';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04]; // PK..
/** OLE (legacy .doc/.ppt/.xls) starts with D0 CF 11 E0 A1 B1 1A E1. */
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

export function isPdfMagicBytes(bytes: Uint8Array): boolean {
  const first = bytes.subarray(0, Math.min(bytes.length, 1024));
  for (let i = 0; i <= first.length - PDF_MAGIC.length; i++) {
    if (startsWith(first, PDF_MAGIC, i)) return true;
  }
  return false;
}

export function isZipMagicBytes(bytes: Uint8Array): boolean {
  return startsWith(bytes, ZIP_LOCAL);
}

/** EPUB is a ZIP whose first entry is the uncompressed "mimetype" file. */
export function isEpubMagicBytes(bytes: Uint8Array): boolean {
  if (!isZipMagicBytes(bytes)) return false;
  const head = new TextDecoder('latin1').decode(
    bytes.slice(0, Math.min(bytes.length, 128)),
  );
  return /mimetype/i.test(head) && /epub/i.test(head);
}

export function isOleMagicBytes(bytes: Uint8Array): boolean {
  return startsWith(bytes, OLE_MAGIC);
}

export type IngestSniffKind =
  | 'pdf'
  | 'zip_container'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'epub'
  | 'ole_legacy'
  | 'unknown';

function hasOoxmlContentTypes(bytes: Uint8Array): boolean {
  if (!isZipMagicBytes(bytes)) return false;
  const head = new TextDecoder('latin1').decode(
    bytes.slice(0, Math.min(bytes.length, 2048)),
  );
  return /\[content_types\]\.xml/i.test(head);
}

/**
 * Content sniff only; extension checks in `isSupportedDropFile` still decide
 * whether we accept the file for browser ingest.
 */
export function sniffIngestKind(bytes: Uint8Array): IngestSniffKind {
  if (!bytes?.length) return 'unknown';
  if (isPdfMagicBytes(bytes)) return 'pdf';
  if (isOleMagicBytes(bytes)) return 'ole_legacy';
  if (isEpubMagicBytes(bytes)) return 'epub';
  if (isZipMagicBytes(bytes)) {
    if (!hasOoxmlContentTypes(bytes)) return 'zip_container';
    const head = new TextDecoder('latin1').decode(
      bytes.slice(0, Math.min(bytes.length, 4096)),
    );
    if (/word\//i.test(head) || /wordprocessingml/i.test(head)) return 'docx';
    if (/ppt\//i.test(head) || /presentationml/i.test(head)) return 'pptx';
    if (/xl\//i.test(head) || /spreadsheetml/i.test(head)) return 'xlsx';
    return 'zip_container';
  }
  return 'unknown';
}

/** Legacy OLE formats we deliberately do not parse in the browser. */
export function isLegacyOleOfficeFile(file: { name?: string; type?: string }): boolean {
  const lower = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return (
    lower.endsWith('.doc') ||
    lower.endsWith('.ppt') ||
    type === 'application/msword' ||
    type === 'application/vnd.ms-powerpoint'
  );
}

/** File-type gating for drag/drop + file picker uploads. */
export function isSupportedDropFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/')) return true;
  if (file.type.startsWith('text/') || file.type === 'application/json') return true;
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return true;
  if (name.endsWith('.epub') || file.type === 'application/epub+zip') return true;
  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return true;
  }
  // Legacy .doc / .ppt are OLE binaries — no light browser extractor; reject at gate.
  if (isPresentationFile(file)) return true;
  if (isZipArchiveFile(file)) return true;
  if (
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel'
  ) {
    return true;
  }
  if (/\.(md|txt|csv|tsv|json|js|ts|tsx|jsx|py|go|rs|java|c|cpp|h|css|html|xml|yaml|yml|toml|sh)$/i.test(name)) {
    return true;
  }
  return false;
}

/** True for Excel workbooks we extract with SheetJS (not plain CSV/TSV). */
export function isSpreadsheetWorkbookFile(file: { name?: string; type?: string }): boolean {
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '');
  return (
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    type === 'application/vnd.ms-excel'
  );
}

/** True for .pptx we unzip + pull `<a:t>` text (not legacy .ppt). */
export function isPresentationFile(file: { name?: string; type?: string }): boolean {
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  return (
    name.endsWith('.pptx') ||
    type === PPTX_MIME ||
    type.includes('presentationml.presentation')
  );
}

/** True for user .zip archives (not OOXML/EPUB which also use zip containers). */
export function isZipArchiveFile(file: { name?: string; type?: string }): boolean {
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  if (name.endsWith('.docx') || name.endsWith('.pptx') || name.endsWith('.xlsx') || name.endsWith('.epub')) {
    return false;
  }
  return (
    name.endsWith('.zip') ||
    type === ZIP_MIME ||
    type === 'application/x-zip-compressed' ||
    type === 'application/x-zip'
  );
}

/**
 * Whether a path inside a ZIP is a supported extract target (same family as drop whitelist).
 * Nested archives are not supported for v1 expand.
 */
export function zipMemberExtractKind(
  path: string,
): 'pdf' | 'epub' | 'docx' | 'pptx' | 'xlsx' | 'xls' | 'image' | 'text' | 'nested_zip' | 'skip' {
  const base = String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || '';
  const lower = base.toLowerCase();
  if (!lower || lower.startsWith('._')) return 'skip';
  if (lower.endsWith('.zip')) return 'nested_zip';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.epub')) return 'epub';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pptx')) return 'pptx';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls')) return 'xls';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lower)) return 'image';
  if (
    /\.(md|markdown|txt|text|csv|tsv|json|js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|c|cpp|h|hpp|css|html|htm|xml|yaml|yml|toml|sh|bash|sql|env|ini)$/i.test(
      lower,
    )
  ) {
    return 'text';
  }
  return 'skip';
}

export function shouldSkipZipMemberPath(path: string): boolean {
  const norm = String(path || '').replace(/\\/g, '/');
  if (!norm || norm.endsWith('/')) return true;
  const parts = norm.split('/').filter(Boolean);
  if (parts.some((p) => p === '__MACOSX' || p.startsWith('._'))) return true;
  return false;
}
