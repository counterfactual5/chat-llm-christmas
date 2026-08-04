/**
 * Response headers for proxied gateway file bytes.
 * Chrome’s built-in PDF viewer in an iframe requires application/pdf
 * (octet-stream + hash URL without .pdf → “Failed to load PDF document”).
 */

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04]; // PK..

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

/** PDF header may sit anywhere in the first 1024 bytes (ISO 32000). */
export function findPdfMagicOffset(buf: ArrayBuffer, limit = 1024): number {
  const bytes = new Uint8Array(buf);
  const max = Math.min(bytes.length, limit) - PDF_MAGIC.length;
  for (let i = 0; i <= max; i++) {
    if (startsWith(bytes, PDF_MAGIC, i)) return i;
  }
  return -1;
}

export function isPdfBytes(buf: ArrayBuffer): boolean {
  return findPdfMagicOffset(buf) >= 0;
}

/** EPUB is a ZIP whose first entry is the uncompressed "mimetype" file. */
export function isEpubBytes(buf: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buf);
  if (!startsWith(bytes, ZIP_LOCAL)) return false;
  const head = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 128)));
  return /mimetype/i.test(head) && /epub/i.test(head);
}

/** Sniff common binary types; keep gateway/fallback when unknown. */
export function sniffBinaryContentType(
  buf: ArrayBuffer,
  fallback = 'application/octet-stream',
): string {
  const bytes = new Uint8Array(buf);
  const given = String(fallback || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (isPdfBytes(buf)) return 'application/pdf';
  if (isEpubBytes(buf)) return 'application/epub+zip';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  // Do not trust a gateway "application/pdf" when magic says otherwise —
  // LibGen downloads often defaulted to .pdf while the bytes were EPUB.
  if (given === 'application/pdf') {
    return 'application/octet-stream';
  }

  if (given && given !== 'application/octet-stream' && given !== 'binary/octet-stream') {
    return given;
  }
  return given || 'application/octet-stream';
}

function safeDownloadName(raw: string, contentType: string): string {
  let name = String(raw || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || '';
  name = name.replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  if (!name) {
    if (contentType === 'application/pdf') return 'document.pdf';
    if (contentType === 'application/epub+zip') return 'book.epub';
    if (contentType.startsWith('image/')) {
      const ext = contentType.slice('image/'.length).split('+')[0] || 'bin';
      return `image.${ext}`;
    }
    return 'download.bin';
  }
  if (contentType === 'application/pdf' && !/\.pdf$/i.test(name)) {
    name = `${name.replace(/\.(epub|bin|octet-stream)$/i, '')}.pdf`;
  }
  if (contentType === 'application/epub+zip') {
    name = name.replace(/\.pdf$/i, '.epub');
    if (!/\.epub$/i.test(name)) name = `${name}.epub`;
  }
  return name.slice(0, 120);
}

/** Content-Disposition: inline so Chrome can embed PDFs in iframes. */
export function inlineContentDisposition(filename: string, contentType: string): string {
  const name = safeDownloadName(filename, contentType);
  const ascii = name.replace(/[^\x20-\x7E]/g, '_') || 'file';
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function fileContentResponseHeaders(opts: {
  buf: ArrayBuffer;
  gatewayContentType?: string | null;
  filename?: string | null;
}): HeadersInit {
  const contentType = sniffBinaryContentType(
    opts.buf,
    opts.gatewayContentType || 'application/octet-stream',
  );
  const filename = String(opts.filename || '').trim() || undefined;
  return {
    'Content-Type': contentType,
    'Content-Length': String(opts.buf.byteLength),
    'Content-Disposition': inlineContentDisposition(filename || '', contentType),
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
}
