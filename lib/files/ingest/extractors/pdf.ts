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
 *
 * Output is aligned with the browser path: page 1 = outline, page 2.. = one
 * `--- page N ---` per PDF page when a reliable per-page split is available.
 */
export async function extractPdfTextFromBytes(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const { buildCatalogPage, serializePagedExtract } = await import(
    '@/lib/files/paged-extract'
  );
  const pdf = await getDocumentProxy(data);
  const pageCount = Number(pdf.numPages) || 0;
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const pagesText = Array.isArray(text) ? text.map((t) => String(t || '').trim()) : [];
  const merged = pagesText.filter(Boolean).join('\n\n').trim();
  const body = merged || String(text || '').trim();
  if (!body) return '';
  const pages = totalPages || pageCount;
  // Single-page document: keep a simple one-page extract (also matches client).
  if (pages <= 1) {
    return body;
  }
  // Multi-page: keep everything in one page 2 body so `file_read` slicing stays
  // simple; only add an outline catalog so the model remembers pagination.
  const limit = Math.min(pages || PDF_PAGE_LIMIT, PDF_PAGE_LIMIT);
  const catalogEntries: Array<{ label: string; kind: string; note: string }> = [
    {
      label: '(document body)',
      kind: 'pages',
      note:
        pages > limit
          ? `extracted first ${limit} of ${pages} pages`
          : `${limit} pages extracted`,
    },
  ];
  return serializePagedExtract([
    {
      page: 1,
      body: buildCatalogPage({
        title: 'PDF extract: page outline',
        entries: catalogEntries,
      }),
    },
    // Per-page slicing is currently left to the client / file_read layer; here
    // we store one body page so server-side read returns a stable chunk.
    { page: 2, title: 'Document', body },
  ]);
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
  const body = pages.join('\n\n').trim();
  if (!body) return '';
  if (doc.numPages <= 1) {
    return body;
  }
  const { buildCatalogPage, serializePagedExtract } = await import(
    '@/lib/files/paged-extract'
  );
  return serializePagedExtract([
    {
      page: 1,
      body: buildCatalogPage({
        title: `PDF extract: ${file.name || 'document.pdf'}`,
        entries: [
          {
            label: '(document body)',
            kind: 'pages',
            note:
              doc.numPages > limit
                ? `extracted first ${limit} of ${doc.numPages} pages`
                : `${limit} pages extracted`,
          },
        ],
      }),
    },
    { page: 2, title: 'Document', body },
  ]);
}

