/** Which generated/account files can be previewed in-product (not only downloaded). */

import { fileExt, isKnownTextFileExt } from '@/lib/files/text-types';

export function isPdfFile(file: { name?: string; mimeType?: string; mime?: string }): boolean {
  const mime = String(file.mimeType || file.mime || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  return mime.includes('pdf') || name.endsWith('.pdf');
}

export function isEpubFile(file: { name?: string; mimeType?: string; mime?: string }): boolean {
  const mime = String(file.mimeType || file.mime || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  return (
    mime.includes('epub') ||
    name.endsWith('.epub') ||
    mime === 'application/epub+zip'
  );
}

export function isPreviewableImageFile(file: {
  name?: string;
  mimeType?: string;
  mime?: string;
}): boolean {
  const mime = String(file.mimeType || file.mime || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(file.name || ''));
}

/** Text / code files File Manager (and chat) will fetch and render inline. */
export function isPreviewableTextFile(file: {
  name?: string;
  mimeType?: string;
  mime?: string;
  filename?: string;
}): boolean {
  const mime = String(file.mimeType || file.mime || '').toLowerCase();
  if (mime.startsWith('text/')) return true;
  // application/json and other catalog MIME types without text/ prefix
  if (mime === 'application/json' || mime === 'application/sql' || mime === 'application/xml') {
    return true;
  }
  if (mime === 'application/x-sh' || mime === 'application/toml' || mime === 'application/x-httpd-php') {
    return true;
  }
  return isKnownTextFileExt(String(file.name || file.filename || ''));
}

/** CSV / TSV / Excel extract — prefer HTML table preview over code fence. */
export function isSpreadsheetPreviewFile(file: {
  name?: string;
  mimeType?: string;
  mime?: string;
  filename?: string;
}): boolean {
  const mime = String(file.mimeType || file.mime || '').toLowerCase();
  if (
    mime.includes('spreadsheet') ||
    mime === 'text/csv' ||
    mime === 'text/tab-separated-values' ||
    mime.includes('excel')
  ) {
    return true;
  }
  const name = String(file.name || file.filename || '').toLowerCase();
  return /\.(xlsx|xls|csv|tsv)$/i.test(name);
}

/** Human-readable type label for preview chrome (not raw MIME). */
export function formatPreviewTypeLabel(file: {
  name?: string;
  mimeType?: string;
  mime?: string;
  filename?: string;
}): string {
  const mime = String(file.mimeType || file.mime || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const name = String(file.name || file.filename || '').toLowerCase();
  if (isEpubFile(file) || mime === 'application/epub+zip') return 'EPUB';
  if (isPdfFile(file) || mime === 'application/pdf') return 'PDF';
  if (isPreviewableImageFile(file) || mime.startsWith('image/')) {
    const sub = mime.startsWith('image/') ? mime.slice(6) : name.split('.').pop() || 'image';
    return sub.toUpperCase();
  }
  if (isSpreadsheetPreviewFile(file) || mime.includes('spreadsheet') || mime.includes('excel')) {
    return 'Excel';
  }
  if (name.endsWith('.docx') || mime.includes('wordprocessingml')) return 'Word';
  if (name.endsWith('.pptx') || mime.includes('presentationml')) return 'PowerPoint';
  if (mime.startsWith('text/')) {
    if (mime.includes('markdown') || name.endsWith('.md')) return 'Markdown';
    if (mime === 'text/csv' || name.endsWith('.csv')) return 'CSV';
    return 'Text';
  }
  if (mime && mime !== 'application/octet-stream') {
    const leaf = mime.includes('/') ? mime.slice(mime.lastIndexOf('/') + 1) : mime;
    return leaf.replace(/\+zip$/i, '').toUpperCase() || mime;
  }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return ext ? ext.toUpperCase() : 'File';
}

/**
 * Inline `content`, or a fetchable `url` for PDF / EPUB / image / text
 * (text is lazy-fetched by the preview panel — not embedded in session JSON).
 */
export function canPreviewGeneratedFile(file: {
  content?: string;
  url?: string;
  name?: string;
  mimeType?: string;
  mime?: string;
  filename?: string;
}): boolean {
  if (typeof file.content === 'string') return true;
  const url = String(file.url || '').trim();
  if (!url) return false;
  return (
    isPdfFile(file) ||
    isEpubFile(file) ||
    isPreviewableImageFile(file) ||
    isPreviewableTextFile(file)
  );
}
