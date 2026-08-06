const PDF_PAGE_LIMIT = 40;

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

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

