import { uploadGatewayFile } from '@/lib/gateway-files';
import type { ChatTool } from '@/lib/tools/registry';

/** Soft cap for generated text files (UTF-8 bytes). */
const MAX_FILE_BYTES = 512 * 1024;

const EXT_MIME: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  py: 'text/x-python',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/tsx',
  jsx: 'text/jsx',
  json: 'application/json',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  sql: 'application/sql',
  sh: 'application/x-sh',
  bash: 'application/x-sh',
  xml: 'application/xml',
  toml: 'application/toml',
  ini: 'text/plain',
  env: 'text/plain',
  rs: 'text/x-rust',
  go: 'text/x-go',
  java: 'text/x-java-source',
  kt: 'text/x-kotlin',
  swift: 'text/x-swift',
  rb: 'text/x-ruby',
  php: 'application/x-httpd-php',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  hpp: 'text/x-c++',
  cs: 'text/x-csharp',
};

const CREATE_FILE_SYSTEM_PROMPT = [
  'You have a create_file tool that saves a downloadable text/code file into this chat’s Output panel.',
  'Call create_file when the user asks you to create, generate, export, or provide a downloadable file (e.g. .md, .py, .ts, .json, .csv, .yaml, .sh).',
  'Do NOT call create_file for ordinary inline code examples in your reply.',
  'For multiple files, call create_file once per file with a clear filename.',
  'Never claim a file was created unless create_file returned ok:true.',
].join(' ');

export function sanitizeGeneratedFilename(raw: string): string {
  let name = String(raw || '')
    .trim()
    .replace(/\\/g, '/');
  name = name.split('/').filter(Boolean).pop() || '';
  name = name.replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  if (!name || name === '.' || name === '..') {
    name = `generated-${Date.now()}.txt`;
  }
  if (name.length > 120) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    name = `${name.slice(0, Math.max(1, 120 - ext.length))}${ext}`;
  }
  return name;
}

export function mimeFromFilename(filename: string, explicit?: string): string {
  const given = String(explicit || '')
    .trim()
    .toLowerCase();
  if (given && /^[\w.+-]+\/[\w.+-]+$/.test(given)) return given;
  const ext = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    : '';
  return EXT_MIME[ext] || 'text/plain';
}

export function createCreateFileTool(): ChatTool {
  return {
    name: 'create_file',
    definition: {
      type: 'function',
      function: {
        name: 'create_file',
        description:
          'Create a downloadable text/code file and save it to the chat Output panel. Use when the user wants a real file (.md, .py, .ts, .json, .csv, etc.), not for ordinary code examples.',
        parameters: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'File name with extension, e.g. README.md or server.py (no directories).',
            },
            content: {
              type: 'string',
              description: 'Full file contents as UTF-8 text.',
            },
            mimeType: {
              type: 'string',
              description: 'Optional MIME type. Inferred from the filename when omitted.',
            },
          },
          required: ['filename', 'content'],
        },
      },
    },
    systemPrompt: CREATE_FILE_SYSTEM_PROMPT,
    enabled: () => true,
    async execute({ rawArguments }, ctx) {
      const apiKey = String(ctx.gateway?.apiKey || '').trim();
      if (!apiKey) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'File creation requires a connected API key.',
          }),
        };
      }

      let args: { filename?: string; content?: string; mimeType?: string } = {};
      try {
        args = JSON.parse(rawArguments || '{}') || {};
      } catch {
        /* bare content not supported */
      }

      const filename = sanitizeGeneratedFilename(String(args.filename || ''));
      const content = String(args.content ?? '');
      if (!content) {
        const message = 'create_file requires non-empty content';
        ctx.send({
          tool: {
            status: 'done',
            name: 'create_file',
            provider: 'files',
            query: filename,
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }

      const mimeType = mimeFromFilename(filename, args.mimeType);
      const bytes = new TextEncoder().encode(content);
      if (bytes.byteLength > MAX_FILE_BYTES) {
        const message = `File too large (max ${MAX_FILE_BYTES} bytes)`;
        ctx.send({
          tool: {
            status: 'done',
            name: 'create_file',
            provider: 'files',
            query: filename,
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }

      ctx.send({
        tool: {
          status: 'start',
          name: 'create_file',
          provider: 'files',
          query: filename,
        },
      });

      try {
        const uploaded = await uploadGatewayFile({
          apiKey,
          baseURL: ctx.gateway?.baseURL,
          bytes,
          filename,
          mime: mimeType,
          purpose: 'assistants',
        });
        const file = {
          id: uploaded.id,
          name: uploaded.filename || filename,
          mimeType,
          size: typeof uploaded.bytes === 'number' ? uploaded.bytes : bytes.byteLength,
          url: `/api/files/${encodeURIComponent(uploaded.id)}`,
          createdAt: Date.now(),
        };
        ctx.send({ file_created: file });
        ctx.send({
          tool: {
            status: 'done',
            name: 'create_file',
            provider: 'files',
            query: file.name,
            results: [
              {
                title: file.name,
                url: file.url,
                snippet: `${file.mimeType} · ${file.size} bytes`,
              },
            ],
          },
        });
        return {
          content: JSON.stringify({
            ok: true,
            file: {
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
              url: file.url,
            },
          }),
          data: file,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'create_file failed';
        ctx.send({
          tool: {
            status: 'done',
            name: 'create_file',
            provider: 'files',
            query: filename,
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
    },
  };
}
