/**
 * Shared between browser ingest and (future) server-driven extraction to keep
 * the `--- page N ---` contract stable. Callers must implement the WASM load
 * and the per-format fallback themselves, but the paging shape and the file
 * type routing table below MUST stay identical, otherwise `parseExtractPages`
 * and any model trained on existing slices will see different layouts.
 */

import type { CatalogEntry } from '@/lib/files/paged-extract';

/**
 * File kinds we route through anydoc-wasm before falling back. Anything not
 * listed returns `null` and the caller keeps its existing path (text files,
 * archives, images, OLE legacy).
 */
export const ANYDOC_ROUTED_KINDS = ['docx', 'pdf', 'pptx', 'epub'] as const;
export type AnydocRoutedKind = (typeof ANYDOC_ROUTED_KINDS)[number];

/**
 * Spreadsheet formats that anydoc CAN handle but we deliberately do NOT send
 * through it on the client. SheetJS keeps sheet/catalog structure that
 * anydoc's CSV-shaped markdown drops; the server MAY switch over if it
 * rebuilds catalog afterwards.
 */
export const ANYDOC_SKIP_ON_CLIENT = ['xlsx', 'xlsm', 'ods', 'csv'] as const;

/** Error codes on the wasm package that mean "fall back, don't retry". */
export const ANYDOC_FALLBACK_ERRORS = [
  'unsupported',
  'malformed',
  'encrypted',
  'resourceLimit',
  'missingPart',
] as const;
export type AnydocFallbackErrorCode = (typeof ANYDOC_FALLBACK_ERRORS)[number];
export function isAnydocFallbackError(err: unknown): err is { code: AnydocFallbackErrorCode } {
  const code = (err as { code?: string } | null | undefined)?.code;
  return !!code && (ANYDOC_FALLBACK_ERRORS as readonly string[]).includes(code);
}

/** Standard catalog entries for anydoc-produced extracts (single body). */
export function anydocCatalogEntries(filename: string): CatalogEntry[] {
  return [
    {
      label: `(document body) ${filename}`,
      kind: 'markdown',
      note: 'via @firecrawl/anydoc-wasm',
      extractedPage: 2,
    },
  ];
}
