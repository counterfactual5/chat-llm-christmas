/**
 * Shared “catalog / outline → paged extract → file_read slice” helpers.
 * Wire format stays `--- page N ---` so extract-slice / file_read stay format-agnostic.
 * “Page” = extract unit (PDF page, PPT slide, ZIP member, …).
 */

/** Soft cap for content units after an optional catalog page (aligns with PDF ingest). */
export const MAX_PAGED_CONTENT_UNITS = 40;

/** ZIP bomb / listing guards (container ingest). */
export const MAX_ZIP_LISTED_ENTRIES = 500;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;

export type PagedExtractUnit = {
  /** 1-based page index in the final extract. */
  page: number;
  /** Optional heading rendered under the page marker (e.g. member path). */
  title?: string;
  body: string;
};

export type CatalogEntry = {
  /** Display path / label. */
  label: string;
  /** Short kind tag (pdf, text, image, …). */
  kind?: string;
  /** Human size hint (e.g. "12KB"). */
  sizeLabel?: string;
  /** When extracted into a content page. */
  extractedPage?: number;
  /** When not extracted — reason for catalog. */
  skipped?: string;
  /** Extra signal e.g. "has image", "image-only" (no vision at ingest). */
  note?: string;
};

export function formatPageMarker(page: number): string {
  return `--- page ${Math.max(1, Math.floor(page))} ---`;
}

/** Build one unit’s text block (marker + optional ## title + body). */
export function formatPagedUnit(unit: PagedExtractUnit): string {
  const title = String(unit.title || '').trim();
  const body = String(unit.body || '').trimEnd();
  const head = title ? `## ${title}\n` : '';
  return `${formatPageMarker(unit.page)}\n${head}${body}`.trimEnd();
}

/** Join units into a single extract sidecar string. */
export function serializePagedExtract(units: PagedExtractUnit[]): string {
  const list = (Array.isArray(units) ? units : [])
    .filter((u) => u && Number.isFinite(u.page) && u.page >= 1)
    .slice()
    .sort((a, b) => a.page - b.page);
  if (!list.length) return '';
  return list.map(formatPagedUnit).join('\n\n').trim();
}

export function formatByteSize(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Standard catalog / outline page body (usually page 1).
 * Lists every entry so nothing is silently omitted from the index.
 */
export function buildCatalogPage(opts: {
  title: string;
  entries: CatalogEntry[];
  footerNotes?: string[];
}): string {
  const title = String(opts.title || 'Catalog').trim() || 'Catalog';
  const entries = Array.isArray(opts.entries) ? opts.entries : [];
  const lines: string[] = [`# ${title}`, ''];
  if (!entries.length) {
    lines.push('(empty)');
  } else {
    entries.forEach((e, i) => {
      const parts: string[] = [`${i + 1}. ${e.label}`];
      if (e.kind) parts.push(e.kind);
      if (e.sizeLabel) parts.push(e.sizeLabel);
      if (e.note) parts.push(e.note);
      if (e.extractedPage != null) {
        parts.push(`extracted → page ${e.extractedPage}`);
      } else if (e.skipped) {
        parts.push(`skipped: ${e.skipped}`);
      }
      lines.push(parts.join(' · '));
    });
  }
  const notes = (opts.footerNotes || []).map((n) => String(n || '').trim()).filter(Boolean);
  if (notes.length) {
    lines.push('');
    for (const n of notes) lines.push(n);
  }
  return lines.join('\n').trim();
}
