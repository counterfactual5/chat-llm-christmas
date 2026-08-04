/**
 * docx_extract — extract a .docx into specialized views:
 *   mode=extract (default) → docx.extract
 *   mode=outline           → docx.outline
 *   mode=comments          → docx.comments (OOXML word/comments.xml)
 *
 * Model tool JSON stays separate from the UI `view_created` SSE event.
 */

import { filesGatewayBaseURL } from '@/lib/files/gateway';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import type {
  DocxCommentsViewData,
  DocxExtractViewData,
  DocxOutlineViewData,
  ToolViewPayload,
} from '@/lib/tools/views/types';
import { normalizeFileId } from '@/lib/tools/file-read/tool';

const MAX_MODEL_CHARS = 24_000;

export type DocxExtractMode = 'extract' | 'outline' | 'comments';

function viewId(): string {
  return `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function parseDocxExtractArgs(
  rawArgs: string,
  fallback: string,
): { fileId: string; mode: DocxExtractMode } {
  let mode: DocxExtractMode = 'extract';
  try {
    const args = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const fileId = String(
        args.file_id || args.fileId || args.id || args.path || args.url || '',
      ).trim();
      const rawMode = String(args.mode || args.view || '').trim().toLowerCase();
      if (rawMode === 'outline' || rawMode === 'comments' || rawMode === 'extract') {
        mode = rawMode;
      }
      if (fileId) return { fileId: normalizeFileId(fileId), mode };
    }
  } catch {
    /* fall through */
  }
  const bare = String(rawArgs || fallback || '').trim();
  if (bare) return { fileId: normalizeFileId(bare), mode };
  return { fileId: '', mode };
}

function stripTags(html: string): string {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Lightweight HTML → markdown for view sections (not a full converter). */
export function htmlFragmentToMarkdown(html: string): string {
  let s = String(html || '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
    const n = Math.min(Math.max(Number(level) || 1, 1), 6);
    return `\n${'#'.repeat(n)} ${stripTags(inner)}\n\n`;
  });
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `- ${stripTags(inner)}\n`);
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => `${stripTags(inner)}\n\n`);
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s).replace(/\n{3,}/g, '\n\n').trim();
}

/** Split mammoth HTML into titled markdown sections (by h1/h2). */
export function sectionsFromDocxHtml(html: string): DocxExtractViewData['sections'] {
  const source = String(html || '').trim();
  if (!source) return [];

  const parts = source.split(/(?=<h[12]\b)/i).filter((p) => p.trim());
  if (parts.length <= 1) {
    const md = htmlFragmentToMarkdown(source);
    return md ? [{ markdown: md }] : [];
  }

  const sections: DocxExtractViewData['sections'] = [];
  for (const part of parts) {
    const headingMatch = part.match(/^<h([12])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (headingMatch) {
      const title = stripTags(headingMatch[2]) || undefined;
      const bodyHtml = part.slice(headingMatch[0].length);
      const markdown = htmlFragmentToMarkdown(bodyHtml);
      sections.push({ title, markdown: markdown || '' });
    } else {
      const markdown = htmlFragmentToMarkdown(part);
      if (markdown) sections.push({ markdown });
    }
  }
  return sections;
}

/** Heading outline from mammoth HTML (h1–h6). */
export function outlineFromDocxHtml(html: string): DocxOutlineViewData['headings'] {
  const headings: DocxOutlineViewData['headings'] = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(String(html || '')))) {
    const level = Math.min(Math.max(Number(match[1]) || 1, 1), 6);
    const text = stripTags(match[2]);
    if (text) headings.push({ level, text });
  }
  return headings;
}

/** Parse word/comments.xml into comment rows. */
export function commentsFromCommentsXml(xml: string): DocxCommentsViewData['comments'] {
  const source = String(xml || '');
  if (!source.trim()) return [];
  const comments: DocxCommentsViewData['comments'] = [];
  const re =
    /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const id = attrs.match(/\bw:id="([^"]*)"/i)?.[1];
    const author = attrs.match(/\bw:author="([^"]*)"/i)?.[1];
    const date = attrs.match(/\bw:date="([^"]*)"/i)?.[1];
    const texts = [...inner.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)].map((m) =>
      decodeEntities(String(m[1] || '')),
    );
    const body = texts.join('').replace(/\s+/g, ' ').trim();
    if (!body && !author && !id) continue;
    comments.push({
      id: id || undefined,
      author: author || undefined,
      date: date || undefined,
      body: body || '(empty)',
    });
  }
  return comments;
}

export async function extractDocxComments(
  buffer: ArrayBuffer,
): Promise<DocxCommentsViewData['comments']> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/comments.xml');
  if (!entry) return [];
  const xml = await entry.async('string');
  return commentsFromCommentsXml(xml);
}

async function fetchGatewayDocxBytes(
  fileId: string,
  apiKey: string | undefined,
): Promise<
  | { ok: true; name: string; mime: string; buffer: ArrayBuffer }
  | { ok: false; error: string }
> {
  if (!apiKey) {
    return { ok: false, error: 'docx_extract requires a logged-in account.' };
  }
  const base = filesGatewayBaseURL();
  const metaRes = await fetch(`${base}/files/${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  let filename = fileId;
  let mime = 'application/octet-stream';
  if (metaRes.ok) {
    try {
      const meta = (await metaRes.json()) as { filename?: string; mime?: string };
      if (meta.filename) filename = String(meta.filename);
      if (meta.mime) mime = String(meta.mime);
    } catch {
      /* ignore */
    }
  }

  const res = await fetch(`${base}/files/${encodeURIComponent(fileId)}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    return {
      ok: false,
      error: `Could not fetch file ${fileId}: HTTP ${res.status}`,
    };
  }
  const ct = (res.headers.get('content-type') || mime || '').split(';')[0].trim().toLowerCase();
  const buffer = await res.arrayBuffer();
  const looksDocx =
    /\.docx$/i.test(filename) ||
    ct.includes('wordprocessingml') ||
    ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  if (!looksDocx) {
    return {
      ok: false,
      error: `File ${filename} does not look like a .docx (${ct || 'unknown type'}).`,
    };
  }

  return {
    ok: true,
    name: filename,
    mime: ct || mime,
    buffer,
  };
}

const DOCX_EXTRACT_SYSTEM_PROMPT = [
  'You also have a docx_extract tool that opens a specialized side-panel view of a .docx.',
  'Pass gateway file_id and optional mode: extract (default, sectioned body), outline (headings), or comments (Word comments).',
  'This is NOT create_file and NOT a full Office editor. Prefer file_read when you only need plain text for reasoning.',
  'Never claim a view was opened unless docx_extract returned ok:true.',
].join(' ');

export function createDocxExtractTool(): ChatTool {
  return {
    name: 'docx_extract',
    definition: {
      type: 'function',
      function: {
        name: 'docx_extract',
        description:
          'Open a .docx attachment as a specialized chat view. mode=extract (default) → structured sections; mode=outline → heading outline; mode=comments → Word comments list. Pass gateway file_id.',
        parameters: {
          type: 'object',
          properties: {
            file_id: {
              type: 'string',
              description:
                'Gateway file id from 【历史文件引用】 / (fileId: …) / uploaded document',
            },
            mode: {
              type: 'string',
              enum: ['extract', 'outline', 'comments'],
              description: 'View mode (default extract)',
            },
          },
          required: ['file_id'],
        },
      },
    },
    systemPrompt: DOCX_EXTRACT_SYSTEM_PROMPT,
    enabled: () => true,
    async execute({ rawArguments, fallbackQuery }, ctx: ToolRuntimeContext) {
      const { fileId, mode } = parseDocxExtractArgs(
        rawArguments,
        fallbackQuery || ctx.userAsk,
      );
      if (!fileId) {
        return {
          content: JSON.stringify({ ok: false, error: 'file_id is required' }),
        };
      }

      const query = `${mode}:${fileId}`.slice(0, 80);
      ctx.send({
        tool: {
          status: 'start',
          name: 'docx_extract',
          query,
          provider: 'docx-extract',
        },
      });

      try {
        const fetched = await fetchGatewayDocxBytes(
          fileId,
          ctx.credentials?.skillsApiKey || ctx.gateway?.apiKey,
        );
        if (!fetched.ok) {
          ctx.send({
            tool: {
              status: 'done',
              name: 'docx_extract',
              query,
              provider: 'docx-extract',
              results: [],
              error: fetched.error,
            },
          });
          return { content: JSON.stringify({ ok: false, error: fetched.error }) };
        }

        let payload: ToolViewPayload;
        let previewText = '';
        let extra: Record<string, unknown> = {};

        if (mode === 'comments') {
          const comments = await extractDocxComments(fetched.buffer);
          const data: DocxCommentsViewData = { comments };
          payload = {
            id: viewId(),
            viewType: 'docx.comments',
            title: fetched.name,
            sourceFileId: fileId,
            sourceFileName: fetched.name,
            createdAt: Date.now(),
            data,
          };
          previewText = comments
            .map((c) => [c.author, c.body].filter(Boolean).join(': '))
            .join('\n');
          extra = { comment_count: comments.length };
        } else if (mode === 'outline') {
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml({ arrayBuffer: fetched.buffer });
          const headings = outlineFromDocxHtml(String(result.value || ''));
          const data: DocxOutlineViewData = { headings };
          payload = {
            id: viewId(),
            viewType: 'docx.outline',
            title: fetched.name,
            sourceFileId: fileId,
            sourceFileName: fetched.name,
            createdAt: Date.now(),
            data,
          };
          previewText = headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
          extra = { heading_count: headings.length };
        } else {
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml({ arrayBuffer: fetched.buffer });
          const html = String(result.value || '');
          let sections = sectionsFromDocxHtml(html);
          if (!sections.length) {
            const raw = await mammoth.extractRawText({ arrayBuffer: fetched.buffer });
            const text = String(raw.value || '').trim();
            if (text) sections = [{ markdown: text }];
          }
          const data: DocxExtractViewData = { sections };
          payload = {
            id: viewId(),
            viewType: 'docx.extract',
            title: fetched.name,
            sourceFileId: fileId,
            sourceFileName: fetched.name,
            createdAt: Date.now(),
            data,
          };
          previewText = sections
            .map((s) => [s.title, s.markdown].filter(Boolean).join('\n'))
            .join('\n\n');
          extra = { section_count: sections.length };
        }

        ctx.send({ view_created: payload });

        const truncated = previewText.length > MAX_MODEL_CHARS;

        ctx.send({
          tool: {
            status: 'done',
            name: 'docx_extract',
            query,
            provider: 'docx-extract',
            results: [
              {
                title: fetched.name,
                url: `/api/files/${encodeURIComponent(fileId)}`,
                snippet: previewText.slice(0, 240) || `(${mode}: empty)`,
              },
            ],
          },
        });

        return {
          content: JSON.stringify({
            ok: true,
            view_id: payload.id,
            view_type: payload.viewType,
            mode,
            file_id: fileId,
            name: fetched.name,
            ...extra,
            text: truncated ? previewText.slice(0, MAX_MODEL_CHARS) : previewText,
            truncated,
          }),
          data: payload,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err || 'failed');
        ctx.send({
          tool: {
            status: 'done',
            name: 'docx_extract',
            query,
            provider: 'docx-extract',
            results: [],
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
    },
  };
}
