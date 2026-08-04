/**
 * file_read — re-read an earlier attached document by fileId.
 *
 * First-turn attaches inject full extracted text into the user message.
 * Older turns (prompt + persisted session) collapse to 【历史文件引用】 markers;
 * the model calls this tool when it needs the full body again. Prefers any
 * per-request extract cache, then chat-api `GET /v1/files/:id/extract` sidecar,
 * then raw text/* content.
 */

import { filesGatewayBaseURL } from '@/lib/files/gateway';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';

const MAX_RETURN_CHARS = 120_000;

export function parseFileReadArgs(
  rawArgs: string,
  fallback: string,
): { fileId: string; focus: string } {
  try {
    const args = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const fileId = String(
        args.file_id || args.fileId || args.id || args.path || args.url || '',
      ).trim();
      const focus = String(args.focus || args.query || args.instruction || '').trim();
      if (fileId) return { fileId: normalizeFileId(fileId), focus };
    }
  } catch {
    // fall through
  }
  const bare = String(rawArgs || fallback || '').trim();
  if (bare) return { fileId: normalizeFileId(bare), focus: '' };
  return { fileId: '', focus: '' };
}

/** Accept bare ids, `/api/files/<id>`, or `fileId: xxx` scraps from markers. */
export function normalizeFileId(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  const fromMarker = s.match(/fileId:\s*([^\s),，]+)/i);
  if (fromMarker?.[1]) s = fromMarker[1].trim();
  if (s.startsWith('/api/files/')) {
    return decodeURIComponent(s.slice('/api/files/'.length).split(/[?#]/)[0] || '');
  }
  return s.replace(/^['"]|['"]$/g, '').trim();
}

async function fetchGatewayFileText(
  fileId: string,
  apiKey: string | undefined,
): Promise<{ ok: true; name: string; text: string; mime: string } | { ok: false; error: string }> {
  if (!apiKey) {
    return { ok: false, error: 'file_read requires a logged-in account.' };
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

  // Prefer upload-time text sidecar (PDF/DOCX/Excel) — survives history collapse.
  const extractRes = await fetch(`${base}/files/${encodeURIComponent(fileId)}/extract`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (extractRes.ok) {
    try {
      const data = (await extractRes.json()) as {
        text?: string;
        filename?: string;
        mime?: string;
      };
      const text = String(data.text || '');
      if (text.trim()) {
        return {
          ok: true,
          name: data.filename ? String(data.filename) : filename,
          text,
          mime: data.mime ? String(data.mime) : mime,
        };
      }
    } catch {
      /* fall through to raw content */
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
  const buf = new Uint8Array(await res.arrayBuffer());
  const looksText =
    /^text\//i.test(ct) ||
    ct === 'application/json' ||
    ct === 'application/xml' ||
    /\.(txt|md|csv|json|xml|html?|js|ts|tsx|jsx|css|py|rs|go|java|c|cpp|h|yml|yaml|toml|ini|log)$/i.test(
      filename,
    );

  // PDF/EPUB extraction runs on chat-api (Node) via GET /extract above —
  // never import unpdf/pdfjs here: /api/chat is Edge and the bundle would exceed
  // Vercel's 1MB limit (and pdfjs needs DOM).
  if (!looksText) {
    return {
      ok: false,
      error: [
        `File ${filename} (${ct || 'binary'}) has no readable text extract yet.`,
        'Ask again in a moment after the extract finishes, or re-download / re-attach the file.',
      ].join(' '),
    };
  }

  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) {
    return {
      ok: false,
      error: `File ${filename} produced an empty text extract.`,
    };
  }
  return { ok: true, name: filename, text, mime: ct || mime };
}

function formatForModel(opts: {
  fileId: string;
  name: string;
  text: string;
  focus?: string;
}): string {
  let body = opts.text;
  let truncated = false;
  if (body.length > MAX_RETURN_CHARS) {
    body = body.slice(0, MAX_RETURN_CHARS);
    truncated = true;
  }
  return [
    `file_id: ${opts.fileId}`,
    `name: ${opts.name}`,
    opts.focus ? `focus: ${opts.focus}` : '',
    truncated ? `truncated: true (first ${MAX_RETURN_CHARS} chars)` : '',
    '---',
    body,
  ]
    .filter(Boolean)
    .join('\n');
}

const FILE_READ_SYSTEM_PROMPT = [
  'You also have a file_read tool to read the full text of documents in this chat.',
  'Sources: (1) user attachments, (2) assistant-delivered files from book_download / create_file / create_spreadsheet.',
  'They appear as 【历史文件引用】 markers with fileId — call file_read with that file_id when the user asks you to read, summarize, quote, or analyze the file.',
  'Do not invent file contents. Prefer the extract returned by the tool over guessing from the filename or preview.',
  'Never claim you cannot read a downloaded book or Output file when a 【历史文件引用】 marker with fileId is present.',
].join(' ');

export function createFileReadTool(): ChatTool {
  return {
    name: 'file_read',
    definition: {
      type: 'function',
      function: {
        name: 'file_read',
        description:
          'Read the full extracted text of a document in this chat. Pass the file_id from a 【历史文件引用】 marker (user attachment, book download, or create_file). Use when the user asks you to read/summarize/analyze that file, or when the short preview is insufficient.',
        parameters: {
          type: 'object',
          properties: {
            file_id: {
              type: 'string',
              description:
                'Gateway file id from 【历史文件引用】 / (fileId: …) / (stored fileId: …)',
            },
            focus: {
              type: 'string',
              description:
                'Optional note about what you need (for your own planning; full text is still returned)',
            },
          },
          required: ['file_id'],
        },
      },
    },
    systemPrompt: FILE_READ_SYSTEM_PROMPT,
    // Lazy-stripped in chat-request when the thread has no attached files.
    enabled: () => true,
    async execute({ rawArguments, fallbackQuery }, ctx) {
      const { fileId, focus } = parseFileReadArgs(
        rawArguments,
        fallbackQuery || ctx.userAsk,
      );
      if (!fileId) {
        return {
          content: JSON.stringify({ ok: false, error: 'file_id is required' }),
        };
      }

      const query = focus || fileId.slice(0, 80);
      ctx.send({
        tool: {
          status: 'start',
          name: 'file_read',
          query,
          provider: 'file-read',
        },
      });

      try {
        const cached = ctx.fileExtracts?.[fileId];
        let name = cached?.name || fileId;
        let text = cached?.text || '';

        if (!text) {
          const fetched = await fetchGatewayFileText(
            fileId,
            ctx.credentials?.skillsApiKey || ctx.gateway?.apiKey,
          );
          if (!fetched.ok) {
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
            return { content: JSON.stringify({ ok: false, error: fetched.error }) };
          }
          name = fetched.name;
          text = fetched.text;
        }

        ctx.send({
          tool: {
            status: 'done',
            name: 'file_read',
            query,
            provider: 'file-read',
            results: [
              {
                title: name,
                url: `/api/files/${encodeURIComponent(fileId)}`,
                snippet: text.slice(0, 240),
              },
            ],
          },
        });
        return {
          content: JSON.stringify({
            ok: true,
            file_id: fileId,
            name,
            text: text.length > MAX_RETURN_CHARS ? text.slice(0, MAX_RETURN_CHARS) : text,
            truncated: text.length > MAX_RETURN_CHARS,
          }),
          data: { fileId, name, text },
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
  return formatForModel(opts);
}
