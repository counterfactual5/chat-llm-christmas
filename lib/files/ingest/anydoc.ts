/**
 * Optional primary converter path backed by firecrawl/anydoc-wasm.
 *
 * Doing doc/docx/pdf/pptx/epub/xlsx → GFM in Rust gives us better table,
 * list, and heading fidelity than the per-format JS extractors we keep as
 * fallback (see `extractor-fallback.ts`). We lazily `await import()` the
 * wasm module so the outer chat bundle stays tiny: the wasm binary is ~6MB
 * and only fetched the first time a real document hits this path.
 */

import {
  buildCatalogPage,
  serializePagedExtract,
  type CatalogEntry,
} from '@/lib/files/paged-extract';
import {
  extractDocxText,
  extractPdfTextFromBytes,
  extractPptxTextFromBytes,
  extractSpreadsheetText,
} from './extractors';
import { isAnydocFallbackError } from './anydoc-paging';

import type { Format } from '@firecrawl/anydoc-wasm';

/** Map a mime/extension to an anydoc `Format` we support. */
function formatForFile(file: { name?: string; type?: string }): Format | null {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  // Legacy OLE (.doc/.ppt/.xls) are still rejected by the ingest layer with a
  // friendly "save as OOXML" error — do not silently route through anydoc.
  if (name.endsWith('.doc') || name.endsWith('.ppt') || name.endsWith('.xls')) return null;
  if (name.endsWith('.docx') || type.includes('wordprocessingml')) return 'docx';
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (name.endsWith('.epub') || type === 'application/epub+zip') return 'epub';
  if (name.endsWith('.pptx') || type.includes('presentationml')) return 'pptx';
  if (
    name.endsWith('.xlsx') ||
    name.endsWith('.xlsm') ||
    name.endsWith('.ods') ||
    name.endsWith('.csv') ||
    type.includes('spreadsheetml') ||
    type === 'application/vnd.ms-excel' ||
    type === 'text/csv'
  ) {
    if (name.endsWith('.ods')) return 'ods';
    if (name.endsWith('.csv') || type === 'text/csv') return 'csv';
    return 'xlsx';
  }
  return null;
}

type AnydocWasm = typeof import('@firecrawl/anydoc-wasm');

let wasmPromise: Promise<AnydocWasm> | null = null;
function loadAnydocWasm(): Promise<AnydocWasm> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const mod = await import('@firecrawl/anydoc-wasm');
      // In Node (vitest, SSR, scripts), resolve the wasm binary via fs so the
      // `new URL(..., import.meta.url)` fetch path (browser-only) never runs.
      // In the browser the published JS glue fetches it from a build-time asset.
      if (typeof window === 'undefined') {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const wasmUrl = (await import.meta.resolve?.('@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm')) ??
          new URL(
            '../node_modules/@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm',
            import.meta.url,
          ).href;
        await mod.default(readFileSync(fileURLToPath(wasmUrl)));
      } else {
        await mod.default();
      }
      return mod;
    })().catch((err) => {
      wasmPromise = null;
      throw err;
    });
  }
  return wasmPromise;
}

/**
 * Try the anydoc-wasm path. Returns `null` when the format isn't covered or
 * the conversion is known-unrecoverable (`unsupported` / `encrypted` /
 * `resourceLimit` / `missingPart` / `malformed`), which the caller uses to
 * fall back to the per-format JS extractors.
 */
export async function anydocExtractText(file: File): Promise<string | null> {
  const format = formatForFile(file);
  if (!format) return null;
  // CSV kicks out a non-document shape — we already handle plain-text files
  // before this path, so don't double-handle here.
  if (format === 'csv') return null;

  let wasm: AnydocWasm;
  try {
    wasm = await loadAnydocWasm();
  } catch {
    return null;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let markdown: string;
  try {
    markdown = wasm.toMarkdownBytes(bytes, format);
  } catch (err) {
    if (isAnydocFallbackError(err)) return null;
    throw err;
  }
  const body = String(markdown || '').trim();
  if (!body) return null;
  return body;
}

/** Wrap anydoc's flat Markdown in our `--- page N ---` catalog-first shape. */
export function anydocPagedExtract(
  markdown: string,
  opts: { filename: string },
): string {
  const body = String(markdown || '').trim();
  if (!body) return '';
  const entries: CatalogEntry[] = [
    {
      label: '(document body)',
      kind: 'markdown',
      extractedPage: 2,
    },
  ];
  return serializePagedExtract([
    {
      page: 1,
      body: buildCatalogPage({
        title: `${opts.filename || 'document'} (anydoc)`,
        entries,
      }),
    },
    { page: 2, title: 'Document', body },
  ]);
}

/**
 * Wrap a markdown body produced by either pipeline into the shared catalog
 * paging shape. The `source` tag surfaces in the catalog so the model can
 * tell whether we used the rust path or the JS fallback — critical for
 * spotting quality regressions when comparing attachments across runs.
 */
export function pagedExtractWithSource(
  markdown: string,
  opts: { filename: string; source: 'anydoc' | 'js-fallback' },
): string {
  const body = String(markdown || '').trim();
  if (!body) return '';
  const titleSuffix = opts.source === 'anydoc' ? '(anydoc)' : '(js fallback)';
  const entries: CatalogEntry[] = [
    {
      label: '(document body)',
      kind: 'markdown',
      note: opts.source === 'anydoc' ? 'via @firecrawl/anydoc-wasm' : 'via js extractor',
      extractedPage: 2,
    },
  ];
  return serializePagedExtract([
    {
      page: 1,
      body: buildCatalogPage({
        title: `${opts.filename || 'document'} ${titleSuffix}`,
        entries,
      }),
    },
    { page: 2, title: 'Document', body },
  ]);
}

/**
 * Public entry: try anydoc-wasm; on failure, fall back to the JS extractors
 * (which already emit their own catalog paging, so we don't double-wrap).
 * Anything else returns `null` so the caller can keep walking the chain.
 */
export async function extractWithAnydocFallback(file: File): Promise<string | null> {
  const name = String(file?.name || '').toLowerCase();
  const filename = file.name || 'document';
  const md = await anydocExtractText(file).catch(() => null);
  if (md) {
    return pagedExtractWithSource(md, { filename, source: 'anydoc' });
  }
  if (name.endsWith('.docx')) return extractDocxText(file).catch(() => null);
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const data = new Uint8Array(await file.arrayBuffer());
    return extractPdfTextFromBytes(data).catch(() => null);
  }
  if (name.endsWith('.pptx')) {
    const data = new Uint8Array(await file.arrayBuffer());
    return extractPptxTextFromBytes(data, { filename }).catch(() => null);
  }
  if (name.endsWith('.epub') || file.type === 'application/epub+zip') {
    const { extractEpubTextFromBytes } = await import('./extractors');
    const data = new Uint8Array(await file.arrayBuffer());
    return extractEpubTextFromBytes(data).catch(() => null);
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    return extractSpreadsheetText(file).catch(() => null);
  }
  return null;
}
