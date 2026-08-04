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
  if (name.endsWith('.doc')) return true;
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
