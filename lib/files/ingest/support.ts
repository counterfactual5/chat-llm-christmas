export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const ZIP_MIME = 'application/zip';

/** File-type gating for drag/drop + file picker uploads. */
export function isSupportedDropFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/')) return true;
  if (file.type.startsWith('text/') || file.type === 'application/json') return true;
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return true;
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
): 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'xls' | 'image' | 'text' | 'nested_zip' | 'skip' {
  const base = String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || '';
  const lower = base.toLowerCase();
  if (!lower || lower.startsWith('._')) return 'skip';
  if (lower.endsWith('.zip')) return 'nested_zip';
  if (lower.endsWith('.pdf')) return 'pdf';
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
