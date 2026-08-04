import { describe, expect, it } from 'vitest';
import {
  fileContentResponseHeaders,
  inlineContentDisposition,
  isEpubBytes,
  isPdfBytes,
  sniffBinaryContentType,
} from '@/lib/files/serve-headers';

function pdfBytes(prefix = ''): ArrayBuffer {
  const text = `${prefix}%PDF-1.4 fake`;
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out.buffer;
}

/** Minimal EPUB: ZIP local header + mimetype entry. */
function epubBytes(): ArrayBuffer {
  const text = 'PK\u0003\u0004\u0014\u0000\u0000\u0000\u0000\u0000xxxxmimetypeapplication/epub+zip';
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out.buffer;
}

describe('sniffBinaryContentType', () => {
  it('detects PDF magic even when gateway says octet-stream', () => {
    expect(sniffBinaryContentType(pdfBytes(), 'application/octet-stream')).toBe(
      'application/pdf',
    );
  });

  it('detects PDF magic after a short preamble', () => {
    expect(isPdfBytes(pdfBytes('\n\n'))).toBe(true);
    expect(sniffBinaryContentType(pdfBytes('\n\n'), 'application/octet-stream')).toBe(
      'application/pdf',
    );
  });

  it('detects EPUB and does not trust a false application/pdf label', () => {
    const buf = epubBytes();
    expect(isEpubBytes(buf)).toBe(true);
    expect(isPdfBytes(buf)).toBe(false);
    expect(sniffBinaryContentType(buf, 'application/pdf')).toBe('application/epub+zip');
  });

  it('keeps an explicit non-binary gateway type when magic is unknown', () => {
    const buf = new TextEncoder().encode('hello').buffer;
    expect(sniffBinaryContentType(buf, 'text/plain; charset=utf-8')).toBe('text/plain');
  });

  it('falls back to octet-stream for unknown binary', () => {
    const buf = new Uint8Array([0x00, 0x01, 0x02]).buffer;
    expect(sniffBinaryContentType(buf, 'application/octet-stream')).toBe(
      'application/octet-stream',
    );
  });
});

describe('fileContentResponseHeaders', () => {
  it('forces inline PDF headers for Chrome iframe embedding', () => {
    const buf = pdfBytes();
    const headers = fileContentResponseHeaders({
      buf,
      gatewayContentType: 'application/octet-stream',
      filename: '论文摘要.pdf',
    }) as Record<string, string>;

    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Length']).toBe(String(buf.byteLength));
    expect(headers['Content-Disposition']).toMatch(/^inline;/);
    expect(headers['Content-Disposition']).toContain("filename*=UTF-8''");
    expect(headers['Content-Disposition']).toContain(encodeURIComponent('论文摘要.pdf'));
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sniffs EPUB content-type without rewriting a .pdf filename', () => {
    const headers = fileContentResponseHeaders({
      buf: epubBytes(),
      gatewayContentType: 'application/pdf',
      filename: 'd7f59f7392fbb541b5603679c7085eda.pdf',
    }) as Record<string, string>;

    expect(headers['Content-Type']).toBe('application/epub+zip');
    expect(headers['Content-Disposition']).toContain('.pdf');
  });

  it('appends .epub only when the stored name has no extension', () => {
    expect(inlineContentDisposition('book-id', 'application/epub+zip')).toContain('book-id.epub');
  });

  it('appends .pdf when the stored name is a bare hash id', () => {
    expect(inlineContentDisposition('d7f59f7392fbb541b56', 'application/pdf')).toContain(
      'd7f59f7392fbb541b56.pdf',
    );
  });
});
