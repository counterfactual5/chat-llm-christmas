import {
  buildCatalogPage,
  MAX_PAGED_CONTENT_UNITS,
  serializePagedExtract,
  type CatalogEntry,
} from '@/lib/files/paged-extract';

export async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const htmlResult = await mammoth.convertToHtml({ arrayBuffer: buffer });
  const html = String(htmlResult.value || '').trim();
  const fromHtml = docxPagedExtractFromHtml(html, file.name || 'document.docx');
  if (fromHtml) return fromHtml;

  const raw = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = String(raw.value || '').trim();
  const hasImage = /<img\b/i.test(html);
  if (!text && !hasImage) return '';
  return serializePagedExtract([
    {
      page: 1,
      body: buildCatalogPage({
        title: `DOCX outline: ${file.name || 'document.docx'}`,
        entries: [
          {
            label: '(document body)',
            kind: 'section',
            note: hasImage ? (text ? 'has image' : 'image-only') : undefined,
            extractedPage: 2,
          },
        ],
      }),
    },
    {
      page: 2,
      title: 'Document',
      body: text || '[image-only document — use file_read for OCR]',
    },
  ]);
}

/** Build paged DOCX extract from mammoth HTML (exported for tests). */
export function docxPagedExtractFromHtml(
  html: string,
  filename = 'document.docx',
): string {
  const sections = sectionsFromMammothHtml(html);
  if (
    !(
      sections.length > 1 ||
      (sections.length === 1 && (sections[0]!.title || sections[0]!.hasImage))
    )
  ) {
    return '';
  }
  const limited = sections.slice(0, MAX_PAGED_CONTENT_UNITS);
  const catalogEntries: CatalogEntry[] = sections.map((s, i) => {
    const label = s.title || `(section ${i + 1})`;
    const note = s.hasImage
      ? s.body.trim()
        ? 'has image'
        : 'image-only'
      : undefined;
    if (i < limited.length) {
      return {
        label,
        kind: 'section',
        note,
        extractedPage: i + 2,
      };
    }
    return { label, kind: 'section', note, skipped: 'extract limit' };
  });
  const footerNotes: string[] = [];
  if (sections.length > limited.length) {
    footerNotes.push(
      `[note: extracted ${limited.length} of ${sections.length} sections into content pages]`,
    );
  }
  return serializePagedExtract([
    {
      page: 1,
      body: buildCatalogPage({
        title: `DOCX outline: ${filename}`,
        entries: catalogEntries,
        footerNotes,
      }),
    },
    ...limited.map((s, i) => ({
      page: i + 2,
      title: s.title || `Section ${i + 1}`,
      body: s.body.trim()
        ? s.body
        : s.hasImage
          ? '[image-only section — use file_read for OCR]'
          : '[empty section]',
    })),
  ]);
}

/** Split mammoth HTML on h1/h2 into titled sections (ingest-local; mirrors docx_extract). */
function sectionsFromMammothHtml(
  html: string,
): Array<{ title?: string; body: string; hasImage: boolean }> {
  const source = String(html || '').trim();
  if (!source) return [];

  const stripTags = (s: string) =>
    String(s || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

  const fragmentHasImage = (fragment: string) => /<img\b/i.test(fragment);

  const htmlToPlain = (fragment: string) => {
    let s = String(fragment || '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/p>/gi, '\n\n');
    s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `- ${stripTags(inner)}\n`);
    s = s.replace(/<[^>]+>/g, ' ');
    s = s
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return s;
  };

  const parts = source.split(/(?=<h[12]\b)/i).filter((p) => p.trim());
  if (parts.length <= 1) {
    const body = htmlToPlain(source);
    const hasImage = fragmentHasImage(source);
    return body || hasImage ? [{ body, hasImage }] : [];
  }

  const sections: Array<{ title?: string; body: string; hasImage: boolean }> = [];
  for (const part of parts) {
    const headingMatch = part.match(/^<h([12])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (headingMatch) {
      const title = stripTags(headingMatch[2]) || undefined;
      const rest = part.slice(headingMatch[0].length);
      const body = htmlToPlain(rest);
      sections.push({ title, body: body || '', hasImage: fragmentHasImage(rest) });
    } else {
      const body = htmlToPlain(part);
      const hasImage = fragmentHasImage(part);
      if (body || hasImage) sections.push({ body, hasImage });
    }
  }
  return sections;
}

