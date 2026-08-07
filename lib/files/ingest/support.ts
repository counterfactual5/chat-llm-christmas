export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const ZIP_MIME = 'application/zip';

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

/** True for Excel workbooks we treat as spreadsheets (not plain CSV/TSV). */
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

/** True for .pptx (not legacy .ppt). */
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
