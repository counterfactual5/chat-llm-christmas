/** Which generated/account files can be previewed in-product (not only downloaded). */

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
  const name = String(file.name || file.filename || '');
  return /\.(?:md|markdown|txt|json|csv|tsv|ya?ml|js|jsx|ts|tsx|py|html?|css|sql|xml|toml|ini|sh|bash|rs|go|java|kt|swift|rb|php|c|h|cpp|hpp|cs|env)$/i.test(
    name,
  );
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
