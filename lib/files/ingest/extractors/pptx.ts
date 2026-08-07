import {
  buildCatalogPage,
  MAX_PAGED_CONTENT_UNITS,
  serializePagedExtract,
  type CatalogEntry,
  type PagedExtractUnit,
} from '@/lib/files/paged-extract';

const MAX_PPTX_SLIDES = 80;

function decodeXmlEntities(raw: string): string {
  return String(raw || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const code = Number.parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

/** Extract one PPTX table (`a:tbl`) into a simple markdown table string. */
function markdownTableFromPptxXml(tbl: string): string {
  const rows: string[][] = [];
  const trRe = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/gi;
  let trm: RegExpExecArray | null;
  while ((trm = trRe.exec(tbl))) {
    const rowXml = trm[1]!;
    const cells: string[] = [];
    const tcRe = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/gi;
    let tcm: RegExpExecArray | null;
    while ((tcm = tcRe.exec(rowXml))) {
      const cellText = textFromPptxXml(tcm[1]!);
      cells.push(cellText);
    }
    if (cells.length) rows.push(cells);
  }
  if (rows.length < 2) {
    return '';
  }
  const width = Math.max(...rows.map((r) => r.length));
  const esc = (c: string) => String(c ?? '').replace(/\|/g, '\\|');
  const line = (r: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => esc(r[i])).join(' | ')} |`;
  const sep = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  return `${line(rows[0]!)}\n${sep}\n${rows.slice(1).map(line).join('\n')}`;
}

/** Pull table fragments (in source order) from a PPTX slide. */
export function tablesFromPptxXml(xml: string): string[] {
  const out: string[] = [];
  const tblRe = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/gi;
  let m: RegExpExecArray | null;
  while ((m = tblRe.exec(xml))) {
    const md = markdownTableFromPptxXml(m[0]!);
    if (md) out.push(md);
  }
  return out;
}

/**
 * Pull plain text runs from a PPTX slide/notes XML fragment, optionally
 * skipping table fragments so table bodies can be rendered separately.
 */
function textFromPptxXml(xml: string, opts?: { skipTables?: boolean }): string {
  const parts: string[] = [];
  if (!opts?.skipTables) {
    const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const t = decodeXmlEntities(m[1]).replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  // Remove table/subtree chunks before extracting runs so we don't re-dump
  // table cells inline; caller renders them as markdown tables instead.
  const withoutTables = String(xml || '').replace(/<a:tbl\b[\s\S]*?<\/a:tbl>/gi, '');
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutTables))) {
    const t = decodeXmlEntities(m[1]).replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function slideTitleFromBody(body: string, slideNum: number, hasImage: boolean): string {
  const first = String(body || '')
    .split(/\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) {
    return hasImage ? `Slide ${slideNum} (image-only)` : `Slide ${slideNum}`;
  }
  const clipped = first.slice(0, 80);
  return clipped.length < first.length ? `${clipped}…` : clipped;
}

function pptxSlideHasImage(xml: string): boolean {
  // DrawingML blip / picture shape — enough to flag without decoding media.
  return /<a:blip\b/i.test(xml) || /<p:pic\b/i.test(xml) || /<asvg:svgBlip\b/i.test(xml);
}

/**
 * Extract .pptx as catalog (page 1) + one unit per slide (page 2..).
 * Image-only slides: catalog notes "image-only"; body stub — OCR via file_read later.
 */
export async function extractPptxTextFromBytes(
  data: Uint8Array,
  opts?: { filename?: string },
): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const slideEntries = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .map((path) => {
      const num = Number(/slide(\d+)\.xml$/i.exec(path)?.[1] || 0);
      return { path, num };
    })
    .filter((e) => e.num > 0)
    .sort((a, b) => a.num - b.num);

  if (!slideEntries.length) return '';

  const limit = Math.min(slideEntries.length, MAX_PPTX_SLIDES, MAX_PAGED_CONTENT_UNITS);
  const slides: Array<{
    num: number;
    title: string;
    body: string;
    hasImage: boolean;
  }> = [];
  for (let i = 0; i < slideEntries.length; i++) {
    if (i >= limit) break;
    const { path, num } = slideEntries[i]!;
    const xml = await zip.files[path]!.async('string');
    const hasImage = pptxSlideHasImage(xml);
    let body = textFromPptxXml(xml, { skipTables: true });
    const tables = tablesFromPptxXml(xml);
    const notesPath = `ppt/notesSlides/notesSlide${num}.xml`;
    let notes = '';
    if (zip.files[notesPath]) {
      notes = textFromPptxXml(await zip.files[notesPath]!.async('string'));
    }
    const chunks: string[] = [];
    if (body) chunks.push(body);
    chunks.push(...tables);
    if (notes) chunks.push(`[notes] ${notes}`);
    body = chunks.join('\n\n');
    const textBody = body.trim();
    slides.push({
      num,
      title: slideTitleFromBody(textBody, num, hasImage),
      body: textBody
        ? body
        : hasImage
          ? '[image-only slide — use file_read for OCR]'
          : '',
      hasImage,
    });
  }

  const catalogEntries: CatalogEntry[] = slideEntries.map((e, i) => {
    if (i < slides.length) {
      const s = slides[i]!;
      const note = s.hasImage
        ? s.body.startsWith('[image-only')
          ? 'image-only'
          : 'has image'
        : undefined;
      return {
        label: `Slide ${e.num}: ${s.title}`,
        kind: 'slide',
        note,
        extractedPage: i + 2,
      };
    }
    return {
      label: `Slide ${e.num}`,
      kind: 'slide',
      skipped: 'extract limit',
    };
  });

  const footerNotes: string[] = [];
  if (slideEntries.length > slides.length) {
    footerNotes.push(
      `[note: extracted ${slides.length} of ${slideEntries.length} slides into content pages]`,
    );
  }

  const name = String(opts?.filename || 'deck.pptx').trim() || 'deck.pptx';
  const units: PagedExtractUnit[] = [
    {
      page: 1,
      body: buildCatalogPage({
        title: `PPTX outline: ${name}`,
        entries: catalogEntries,
        footerNotes,
      }),
    },
    ...slides.map((s, i) => ({
      page: i + 2,
      title: `Slide ${s.num}: ${s.title}`,
      body: s.body || '[empty slide]',
    })),
  ];
  const out = serializePagedExtract(units);
  if (out) return out;
  return `[PPTX with ${slideEntries.length} slides; no extractable text layer]`;
}

export async function extractPptxText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  return extractPptxTextFromBytes(data, { filename: file.name || 'deck.pptx' });
}

