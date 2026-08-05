/**
 * file_read — on-demand slice of an earlier document by fileId.
 *
 * Context keeps 【历史文件引用】 only; this tool returns a short page window
 * (start_page / max_pages / focus). Prefers chat-api extract sidecar.
 */

import { filesGatewayBaseURL } from '@/lib/files/gateway';
import {
  parseExtractPages,
  resolveAutoStartPage,
  sliceExtractForRead,
} from '@/lib/files/extract-slice';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';

/** Per-call return cap — overview / chapter, not whole book. */
const MAX_RETURN_CHARS = 28_000;
const DEFAULT_MAX_PAGES = 8;
/** Pages with fewer chars are treated as empty for on-demand OCR. */
const MIN_PAGE_CHARS_FOR_OCR = 40;
const MAX_OCR_PAGES_PER_CALL = 8;

/**
 * Which pages in the current read window should be OCR'd on demand.
 * Scanned/ImageBased: empty/missing pages in the window.
 * Mixed / Unknown: known-empty pages in the extract (or classify-listed).
 * TextBased: known-empty pages as misclassification fallback (capped per call).
 * EPUB / PPTX: only listed image pages (epub_image_pages / pptx_image_slides).
 */
export function pagesNeedingOcrInWindow(opts: {
  pages: Array<{ page: number; text: string }>;
  startPage: number;
  maxPages: number;
  pagesNeedingOcr: number[];
  pdfType: string | null;
  docKind?: string | null;
}): number[] {
  const pdfType = String(opts.pdfType || '');
  const docKind = String(opts.docKind || '').toLowerCase();
  const isZipDoc = docKind === 'epub' || docKind === 'pptx';
  const listed = new Set(
    (opts.pagesNeedingOcr || [])
      .map((n) => Math.floor(Number(n)))
      .filter((n) => n >= 1),
  );

  const start = Math.max(1, Math.floor(Number(opts.startPage)) || 1);
  const max = Math.min(
    MAX_OCR_PAGES_PER_CALL,
    Math.max(1, Math.floor(Number(opts.maxPages)) || DEFAULT_MAX_PAGES),
  );
  /** Limit TextBased 误判兜底 so blank chapter dividers don't OCR a full window. */
  const outCap = pdfType === 'TextBased' ? 2 : max;
  const byPage = new Map(opts.pages.map((p) => [p.page, p.text]));
  const scannedLike =
    pdfType === 'Scanned' || pdfType === 'ImageBased';
  const out: number[] = [];
  for (let p = start; p < start + max; p++) {
    const hasPage = byPage.has(p);
    const body = String(byPage.get(p) || '').trim();
    if (body.length >= MIN_PAGE_CHARS_FOR_OCR) continue;
    if (isZipDoc) {
      // Comic EPUB / image slides: only pages with known media refs.
      if (!listed.has(p)) continue;
      out.push(p);
    } else if (scannedLike) {
      out.push(p);
    } else {
      // TextBased / Mixed / Unknown: don't OCR pages not yet in the sidecar.
      if (!hasPage && !listed.has(p)) continue;
      out.push(p);
    }
    if (out.length >= outCap) break;
  }
  return out;
}

async function requestOcrPages(
  fileId: string,
  pages: number[],
  apiKey: string,
): Promise<{
  ok: boolean;
  text?: string;
  ocrPages?: Array<{ page: number; provider?: string; chars?: number; error?: string }>;
  pagesNeedingOcr?: number[];
  needsOcr?: boolean;
  error?: string;
}> {
  if (!pages.length) return { ok: true };
  const base = filesGatewayBaseURL();
  const res = await fetch(
    `${base}/files/${encodeURIComponent(fileId)}/ocr-pages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pages }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    text?: string;
    ocr_pages?: Array<{
      page: number;
      provider?: string;
      chars?: number;
      error?: string;
    }>;
    pages_needing_ocr?: number[];
    needs_ocr?: boolean;
    message?: string;
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: String(
        data.message || data.error || `OCR HTTP ${res.status}`,
      ).slice(0, 300),
    };
  }
  return {
    ok: true,
    text: String(data.text || ''),
    ocrPages: Array.isArray(data.ocr_pages) ? data.ocr_pages : [],
    pagesNeedingOcr: Array.isArray(data.pages_needing_ocr)
      ? data.pages_needing_ocr
      : [],
    needsOcr: Boolean(data.needs_ocr),
  };
}

export type FileReadArgs = {
  fileId: string;
  focus: string;
  startPage: number;
  maxPages: number;
  /** True when the model/user passed start_page (including 1). */
  startPageExplicit: boolean;
};

export function parseFileReadArgs(rawArgs: string, fallback: string): FileReadArgs {
  const empty: FileReadArgs = {
    fileId: '',
    focus: '',
    startPage: 1,
    maxPages: DEFAULT_MAX_PAGES,
    startPageExplicit: false,
  };
  try {
    const args = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      let fileId = String(
        args.file_id || args.fileId || args.id || args.path || args.url || '',
      ).trim();
      // Weaker models reuse search-tool shape: {"query":"file-…"}.
      const queryRaw = String(args.query || '').trim();
      if (!fileId && looksLikeFileIdToken(queryRaw)) {
        fileId = queryRaw;
      }
      if (!fileId) {
        fileId = scrapeFileIdToken(JSON.stringify(args));
      }
      const focusExplicit = String(args.focus || args.instruction || '').trim();
      const focus =
        focusExplicit ||
        (queryRaw && !looksLikeFileIdToken(queryRaw) ? queryRaw : '');
      const startPageExplicit =
        args.start_page != null || args.startPage != null;
      const startPage = Math.max(
        1,
        Math.floor(Number(args.start_page ?? args.startPage ?? 1)) || 1,
      );
      const maxPagesRaw = Number(args.max_pages ?? args.maxPages ?? DEFAULT_MAX_PAGES);
      const maxPages = Math.min(
        40,
        Math.max(1, Math.floor(maxPagesRaw) || DEFAULT_MAX_PAGES),
      );
      if (fileId) {
        return {
          fileId: normalizeFileId(fileId),
          focus,
          startPage,
          maxPages,
          startPageExplicit,
        };
      }
      // Parsed JSON but no file id — do not treat the whole blob as an id.
      return empty;
    }
  } catch {
    // fall through
  }
  const bare = String(rawArgs || fallback || '').trim();
  if (!bare) return empty;
  if (bare.startsWith('{') || bare.startsWith('[')) {
    const scraped = scrapeFileIdToken(bare);
    if (scraped) return { ...empty, fileId: normalizeFileId(scraped) };
    return empty;
  }
  return { ...empty, fileId: normalizeFileId(bare) };
}

/** True when a string is plausibly a gateway file id (not a search phrase). */
export function looksLikeFileIdToken(raw: string): boolean {
  const s = String(raw || '').trim();
  if (!s || s.length > 160) return false;
  if (/^\/api\/files\//i.test(s)) return true;
  return /^file-[a-zA-Z0-9_-]+$/i.test(s);
}

function scrapeFileIdToken(raw: string): string {
  const s = String(raw || '');
  const m =
    s.match(/\bfile-[a-f0-9]{20,}\b/i) ||
    s.match(/\bfile-[a-zA-Z0-9_-]{12,}\b/);
  return m?.[0] || '';
}

/** Accept bare ids, `/api/files/<id>`, or `fileId: xxx` scraps from markers. */
export function normalizeFileId(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  // Never keep a JSON arguments blob as the id.
  if (s.startsWith('{') || s.startsWith('[')) {
    return scrapeFileIdToken(s);
  }
  const fromMarker = s.match(/fileId:\s*([^\s),，]+)/i);
  if (fromMarker?.[1]) s = fromMarker[1].trim();
  if (s.startsWith('/api/files/')) {
    return decodeURIComponent(s.slice('/api/files/'.length).split(/[?#]/)[0] || '');
  }
  return s.replace(/^['"]|['"]$/g, '').trim();
}

type FetchOk = {
  ok: true;
  name: string;
  text: string;
  mime: string;
  partial?: boolean;
  totalPages?: number | null;
  extractedPages?: number | null;
  bodyStartPage?: number | null;
  outline?: Array<{ title?: string; page?: number | null }>;
  pdfType?: string | null;
  pdfConfidence?: number | null;
  pagesNeedingOcr?: number[];
  needsOcr?: boolean;
  docKind?: string | null;
};
type FetchErr = {
  ok: false;
  error: string;
  code?: string;
  pdfType?: string | null;
  needsOcr?: boolean;
  pagesNeedingOcr?: number[];
};

async function fetchGatewayFileText(
  fileId: string,
  apiKey: string | undefined,
): Promise<FetchOk | FetchErr> {
  if (!apiKey) {
    return { ok: false, error: 'file_read requires a logged-in account.', code: 'UNAUTHORIZED' };
  }
  const base = filesGatewayBaseURL();
  const metaRes = await fetch(`${base}/files/${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (metaRes.status === 404) {
    return {
      ok: false,
      error: `File not found: ${fileId}`,
      code: 'FILE_NOT_FOUND',
    };
  }
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

  const extractRes = await fetch(`${base}/files/${encodeURIComponent(fileId)}/extract`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (extractRes.ok) {
    try {
      const data = (await extractRes.json()) as {
        text?: string;
        filename?: string;
        mime?: string;
        partial?: boolean;
        total_pages?: number | null;
        extracted_pages?: number | null;
        body_start_page?: number | null;
        outline?: Array<{ title?: string; page?: number | null }>;
        pdf_type?: string | null;
        pdf_confidence?: number | null;
        pages_needing_ocr?: number[];
        needs_ocr?: boolean;
        doc_kind?: string | null;
        epub_image_pages?: number[];
        pptx_image_slides?: number[];
      };
      const text = String(data.text || '');
      const needsOcrFlag = Boolean(data.needs_ocr);
      const docKind = data.doc_kind
        ? String(data.doc_kind)
        : /\.epub$/i.test(filename) || mime === 'application/epub+zip'
          ? 'epub'
          : /\.pptx$/i.test(filename) ||
              mime.includes('presentationml')
            ? 'pptx'
            : null;
      const listedNeed = Array.isArray(data.pages_needing_ocr)
        ? data.pages_needing_ocr
        : Array.isArray(data.epub_image_pages)
          ? data.epub_image_pages
          : Array.isArray(data.pptx_image_slides)
            ? data.pptx_image_slides
            : [];
      // Empty placeholder extract is OK when OCR is available on demand.
      if (text.trim() || needsOcrFlag || listedNeed.length) {
        return {
          ok: true,
          name: data.filename ? String(data.filename) : filename,
          text,
          mime: data.mime ? String(data.mime) : mime,
          partial: Boolean(data.partial),
          totalPages: data.total_pages ?? null,
          extractedPages: data.extracted_pages ?? null,
          bodyStartPage:
            Number(data.body_start_page) > 0 ? Number(data.body_start_page) : null,
          outline: Array.isArray(data.outline) ? data.outline : [],
          pdfType: data.pdf_type ?? null,
          pdfConfidence:
            Number(data.pdf_confidence) > 0 ? Number(data.pdf_confidence) : null,
          pagesNeedingOcr: listedNeed,
          needsOcr: needsOcrFlag || listedNeed.length > 0,
          docKind,
        };
      }
    } catch {
      /* fall through */
    }
  } else if (extractRes.status === 404) {
    let code = 'EXTRACT_NOT_FOUND';
    let detail = '';
    try {
      const body = (await extractRes.json()) as { code?: string; message?: string; error?: string };
      if (body.code) code = String(body.code);
      detail = String(body.message || body.error || '');
    } catch {
      /* ignore */
    }
    if (code === 'FILE_NOT_FOUND') {
      return { ok: false, error: detail || `File not found: ${fileId}`, code };
    }
    // EXTRACT_NOT_FOUND on a known file — unusual if auto-build is on; surface clearly.
  } else if (extractRes.status === 422) {
    let detail = `Could not extract text from ${filename}`;
    let code = 'EXTRACT_FAILED';
    let pdfType: string | null = null;
    let needsOcr = false;
    let pagesNeedingOcr: number[] = [];
    try {
      const body = (await extractRes.json()) as {
        code?: string;
        message?: string;
        error?: string;
        pdf_type?: string;
        needs_ocr?: boolean;
        pages_needing_ocr?: number[];
      };
      detail = String(body.message || body.error || detail);
      code = String(body.code || 'EXTRACT_FAILED');
      pdfType = body.pdf_type ? String(body.pdf_type) : null;
      needsOcr = Boolean(body.needs_ocr) || code === 'NEEDS_OCR';
      pagesNeedingOcr = Array.isArray(body.pages_needing_ocr)
        ? body.pages_needing_ocr
        : [];
    } catch {
      /* ignore */
    }
    // Legacy 422 NEEDS_OCR — still try on-demand OCR for the requested window.
    if (needsOcr || code === 'NEEDS_OCR') {
      return {
        ok: true,
        name: filename,
        text: '',
        mime,
        partial: true,
        totalPages: null,
        extractedPages: 0,
        bodyStartPage: null,
        outline: [],
        pdfType,
        pdfConfidence: null,
        pagesNeedingOcr,
        needsOcr: true,
      };
    }
    return {
      ok: false,
      error: detail,
      code,
      pdfType,
      needsOcr,
      pagesNeedingOcr,
    };
  }

  const res = await fetch(`${base}/files/${encodeURIComponent(fileId)}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const code = res.status === 404 ? 'FILE_NOT_FOUND' : 'CONTENT_FETCH_FAILED';
    return {
      ok: false,
      error: `Could not fetch file ${fileId}: HTTP ${res.status}`,
      code,
    };
  }
  const ct = (res.headers.get('content-type') || mime || '').split(';')[0].trim().toLowerCase();
  const buf = new Uint8Array(await res.arrayBuffer());
  const looksText =
    /^text\//i.test(ct) ||
    ct === 'application/json' ||
    ct === 'application/xml' ||
    /\.(txt|md|csv|json|xml|html?|js|ts|tsx|jsx|css|py|rs|go|java|c|cpp|h|yml|yaml|toml|ini|log)$/i.test(
      filename,
    );

  if (!looksText) {
    return {
      ok: false,
      error: [
        `File ${filename} (${ct || 'binary'}) has no readable text extract yet.`,
        'Wait a moment for background extraction, then call file_read again.',
      ].join(' '),
      code: 'EXTRACT_PENDING',
    };
  }

  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) {
    return {
      ok: false,
      error: `File ${filename} produced an empty text extract.`,
      code: 'EXTRACT_EMPTY',
    };
  }
  return { ok: true, name: filename, text, mime: ct || mime, partial: false };
}

const FILE_READ_SYSTEM_PROMPT = [
  'You also have a file_read tool for documents in this chat (user attachments and book_download / paper_download / create_file outputs).',
  'They appear as 【历史文件引用】 with fileId — call file_read with that file_id (parameter name is file_id, not query).',
  'Each call returns a SHORT slice (~8 pages by default), not the whole book — this is a context budget, separate from TOC skipping.',
  'Omitting start_page auto-skips table-of-contents / front matter when possible (PDF outline or text heuristic) and starts near the body; you still only get ~8 pages from that start.',
  'To read the TOC or cover, pass start_page=1 explicitly, or focus="contents" / "目录".',
  'Scanned or Mixed PDFs OCR empty pages in the current window on demand; TextBased also OCRs known-empty pages as a misclassification fallback (not whole-book OCR). Never say you cannot read a scanned PDF when a 【历史文件引用】 marker is present.',
  'Comic / image-heavy EPUBs and image-only PPTX slides also OCR on demand in the current window (same file_read tool; start_page = chapter or slide number). Prefer file_read over inventing slide/chapter text.',
  'Workflow: first call with only file_id for a body overview; then call again with start_page or focus to drill into chapters.',
  'When has_more is true, continue with a higher start_page. Never invent file contents.',
  'Never claim you cannot read a downloaded book when a 【历史文件引用】 marker is present.',
].join(' ');

export function createFileReadTool(): ChatTool {
  return {
    name: 'file_read',
    definition: {
      type: 'function',
      function: {
        name: 'file_read',
        description:
          'Read a slice of a document in this chat (PDF/EPUB/PPTX; default ~8 pages/slides). Pass file_id from 【历史文件引用】. Omitting start_page auto-skips TOC when possible. Use start_page / max_pages / focus to dig deeper — do not expect the whole book in one call.',
        parameters: {
          type: 'object',
          properties: {
            file_id: {
              type: 'string',
              description:
                'Gateway file id from 【历史文件引用】 / (fileId: …) / (stored fileId: …)',
            },
            start_page: {
              type: 'number',
              description:
                '1-based page/slide to start from. Omit for auto body start (skip TOC); pass 1 to include cover/TOC. For PPTX this is the slide number.',
            },
            max_pages: {
              type: 'number',
              description: 'Max pages/slides to return this call (default 8, max 40)',
            },
            focus: {
              type: 'string',
              description:
                'Optional keyword/topic; returns a window around the first match. Use "contents"/"目录" to read the TOC.',
            },
          },
          required: ['file_id'],
        },
      },
    },
    systemPrompt: FILE_READ_SYSTEM_PROMPT,
    enabled: () => true,
    async execute({ rawArguments, fallbackQuery, callId }, ctx) {
      const { fileId, focus, startPage, maxPages, startPageExplicit } =
        parseFileReadArgs(rawArguments, fallbackQuery || ctx.userAsk);
      if (!fileId) {
        const missing = '(missing file_id)';
        ctx.send({
          tool: {
            status: 'start',
            name: 'file_read',
            query: missing,
            provider: 'file-read',
          },
        });
        ctx.send({
          tool: {
            status: 'done',
            name: 'file_read',
            query: missing,
            provider: 'file-read',
            results: [],
            error: 'file_id is required',
          },
        });
        return {
          content: JSON.stringify({
            ok: false,
            error: 'file_id is required',
            code: 'BAD_ARGS',
          }),
        };
      }

      const query =
        focus ||
        (startPageExplicit && startPage > 1
          ? `p.${startPage}+${maxPages}`
          : fileId.slice(0, 80));
      const parentCallId = String(callId || '').trim();
      ctx.send({
        tool: {
          status: 'start',
          name: 'file_read',
          query,
          provider: 'file-read',
          ...(parentCallId ? { callId: parentCallId } : {}),
        },
      });

      try {
        const cached = ctx.fileExtracts?.[fileId];
        let name = cached?.name || fileId;
        let text = cached?.text || '';
        let partialExtract = false;
        let extractTotal: number | null | undefined;
        let extractPages: number | null | undefined;
        let bodyStartFromMeta: number | null = null;
        let outline: Array<{ title?: string; page?: number | null }> = [];
        let pdfType: string | null = null;
        let needsOcr = false;
        let pagesNeedingOcr: number[] = [];
        let docKind: string | null = null;

        // Prefer gateway (may include freshly OCR'd pages); fall back to in-turn cache.
        const fetched = await fetchGatewayFileText(
          fileId,
          ctx.credentials?.skillsApiKey || ctx.gateway?.apiKey,
        );
        if (!fetched.ok) {
          if (!text) {
            ctx.send({
              tool: {
                status: 'done',
                name: 'file_read',
                query,
                provider: 'file-read',
                results: [],
                error: fetched.error,
              },
            });
            return {
              content: JSON.stringify({
                ok: false,
                error: fetched.error,
                code: fetched.code,
                pdf_type: fetched.pdfType ?? null,
                needs_ocr: Boolean(fetched.needsOcr),
                pages_needing_ocr: fetched.pagesNeedingOcr || [],
                tip:
                  fetched.needsOcr || fetched.code === 'NEEDS_OCR'
                    ? 'This document looks image-based. Call file_read again after OCR is available, or ensure the gateway OCR endpoint is configured.'
                    : undefined,
              }),
            };
          }
        } else {
          name = fetched.name || name;
          text = fetched.text || text;
          partialExtract = Boolean(fetched.partial);
          extractTotal = fetched.totalPages;
          extractPages = fetched.extractedPages;
          bodyStartFromMeta = fetched.bodyStartPage ?? null;
          outline = fetched.outline || [];
          pdfType = fetched.pdfType ?? null;
          needsOcr = Boolean(fetched.needsOcr);
          pagesNeedingOcr = fetched.pagesNeedingOcr || [];
          docKind = fetched.docKind ?? null;
          if (!docKind) {
            if (/\.epub$/i.test(name)) docKind = 'epub';
            else if (/\.pptx$/i.test(name)) docKind = 'pptx';
          }
        }

        const pages = parseExtractPages(text);
        const auto = resolveAutoStartPage({
          pages,
          startPageExplicit,
          startPage,
          focus,
          outlineBodyStart: bodyStartFromMeta,
        });

        let ocrApplied: number[] = [];
        let ocrProviders: string[] = [];
        let ocrError: string | undefined;
        const apiKey =
          ctx.credentials?.skillsApiKey || ctx.gateway?.apiKey || '';
        const needOcrPages = pagesNeedingOcrInWindow({
          pages,
          startPage: auto.startPage,
          maxPages,
          pagesNeedingOcr,
          pdfType,
          docKind,
        });
        if (needOcrPages.length && apiKey) {
          const ocrQuery = `ocr p.${needOcrPages.join(',')}`;
          // Distinct from parent file_read callId so Process does not supersede it.
          const ocrCallId = `${parentCallId || 'file_read'}:ocr:${needOcrPages.join('-')}`;
          ctx.send({
            tool: {
              status: 'start',
              name: 'file_read',
              query: ocrQuery,
              provider: 'pdf-ocr',
              callId: ocrCallId,
            },
          });
          const ocr = await requestOcrPages(fileId, needOcrPages, apiKey);
          if (ocr.ok && ocr.text?.trim()) {
            text = ocr.text;
            if (ctx.fileExtracts) {
              ctx.fileExtracts[fileId] = { name, text };
            }
            pagesNeedingOcr = ocr.pagesNeedingOcr ?? pagesNeedingOcr;
            needsOcr = ocr.needsOcr ?? needsOcr;
            ocrApplied = (ocr.ocrPages || [])
              .filter((r) => !r.error && (r.chars || 0) > 0)
              .map((r) => r.page);
            ocrProviders = [
              ...new Set(
                (ocr.ocrPages || [])
                  .map((r) => String(r.provider || ''))
                  .filter((p) => p && p !== 'existing' && p !== 'error'),
              ),
            ];
            const failed = (ocr.ocrPages || []).filter((r) => r.error);
            if (failed.length && !ocrApplied.length) {
              ocrError = failed
                .map((r) => `p${r.page}: ${r.error}`)
                .join('; ')
                .slice(0, 240);
            }
            ctx.send({
              tool: {
                status: 'done',
                name: 'file_read',
                query: ocrQuery,
                provider: ocrProviders[0] || 'pdf-ocr',
                callId: ocrCallId,
                results: ocrApplied.length
                  ? [
                      {
                        title: name,
                        url: `/api/files/${encodeURIComponent(fileId)}`,
                        snippet: `OCR pages ${ocrApplied.join(', ')}`,
                      },
                    ]
                  : [],
                error: ocrError,
              },
            });
          } else if (!ocr.ok) {
            ocrError = ocr.error;
            console.warn('[file_read] on-demand OCR failed:', ocr.error);
            ctx.send({
              tool: {
                status: 'done',
                name: 'file_read',
                query: ocrQuery,
                provider: 'pdf-ocr',
                callId: ocrCallId,
                results: [],
                error: ocrError,
              },
            });
          }
        }

        const slice = sliceExtractForRead(text, {
          startPage: auto.startPage,
          maxPages,
          focus,
          maxChars: MAX_RETURN_CHARS,
        });
        const totalPages = extractTotal || slice.totalPages;
        const tips: string[] = [];
        if (auto.skippedToc && auto.bodyStartPage) {
          tips.push(
            `Skipped front matter/TOC; started at page ${auto.bodyStartPage} (${auto.source}). Pass start_page=1 or focus="contents" to read the TOC.`,
          );
        }
        if (ocrApplied.length) {
          tips.push(
            `OCR applied to page(s) ${ocrApplied.join(', ')}${
              ocrProviders.length ? ` via ${ocrProviders.join('+')}` : ''
            }.`,
          );
        } else if (ocrError) {
          tips.push(`On-demand OCR failed: ${ocrError}`);
        } else if (needsOcr && pagesNeedingOcr.length) {
          const kindLabel =
            docKind === 'epub'
              ? 'image-heavy EPUB'
              : docKind === 'pptx'
                ? 'image slides in PPTX'
                : `PDF classified as ${pdfType || 'Mixed'}`;
          tips.push(
            `${kindLabel}; pages still needing OCR: ${pagesNeedingOcr.slice(0, 12).join(', ')}${pagesNeedingOcr.length > 12 ? '…' : ''}.`,
          );
        } else if (pdfType && pdfType !== 'TextBased') {
          tips.push(`PDF classified as ${pdfType}.`);
        }
        if (slice.hasMore) {
          tips.push(
            `More pages available — call file_read again with start_page=${slice.endPage + 1}.`,
          );
        } else if (partialExtract) {
          tips.push(
            'Extract may still be growing in the background; retry later for later pages.',
          );
        }
        const tip = tips.join(' ');

        ctx.send({
          tool: {
            status: 'done',
            name: 'file_read',
            query,
            provider: 'file-read',
            ...(parentCallId ? { callId: parentCallId } : {}),
            results: [
              {
                title: name,
                url: `/api/files/${encodeURIComponent(fileId)}`,
                snippet: slice.text.slice(0, 240),
              },
            ],
          },
        });
        return {
          content: JSON.stringify({
            ok: true,
            file_id: fileId,
            name,
            start_page: slice.startPage,
            end_page: slice.endPage,
            total_pages: totalPages || null,
            extracted_pages: extractPages ?? null,
            has_more: slice.hasMore,
            partial_extract: partialExtract,
            matched_focus: slice.matchedFocus,
            skipped_toc: auto.skippedToc,
            body_start_page: auto.bodyStartPage,
            auto_start_source: auto.source,
            pdf_type: pdfType,
            doc_kind: docKind,
            needs_ocr: needsOcr,
            pages_needing_ocr: pagesNeedingOcr,
            ocr_pages: ocrApplied.length ? ocrApplied : undefined,
            outline_preview: outline.slice(0, 12).map((e) => ({
              title: e.title,
              page: e.page ?? null,
            })),
            tip: tip || undefined,
            text: slice.text,
          }),
          data: { fileId, name, text: slice.text },
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err || 'failed');
        ctx.send({
          tool: {
            status: 'done',
            name: 'file_read',
            query,
            provider: 'file-read',
            results: [],
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
    },
  };
}

export function formatFileReadForModel(opts: {
  fileId: string;
  name: string;
  text: string;
  focus?: string;
}): string {
  const slice = sliceExtractForRead(opts.text, {
    focus: opts.focus,
    maxChars: MAX_RETURN_CHARS,
  });
  return [
    `file_id: ${opts.fileId}`,
    `name: ${opts.name}`,
    opts.focus ? `focus: ${opts.focus}` : '',
    `pages: ${slice.startPage}-${slice.endPage} / ${slice.totalPages || '?'}`,
    slice.hasMore ? 'has_more: true' : '',
    '---',
    slice.text,
  ]
    .filter(Boolean)
    .join('\n');
}
