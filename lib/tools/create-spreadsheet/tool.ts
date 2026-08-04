/**
 * create_spreadsheet — build a real .xlsx, upload to Files, preview via extract TSV.
 */

import { sanitizeGeneratedFilename } from '@/lib/tools/create-file/tool';
import { uploadGatewayFile } from '@/lib/files/gateway/upload';
import {
  CREATE_SPREADSHEET_MAX_COLS,
  CREATE_SPREADSHEET_MAX_ROWS,
  CREATE_SPREADSHEET_MAX_SHEETS,
  SPREADSHEET_MIME,
  buildXlsxBytes,
  sheetsToExtractText,
  type SpreadsheetSheetInput,
} from '@/lib/files/spreadsheet';
import type { ChatTool } from '@/lib/tools/registry';

const MAX_XLSX_BYTES = 8 * 1024 * 1024;

const SYSTEM = [
  'You have a create_spreadsheet tool that builds a real Excel .xlsx file and saves it to this chat’s Output / Files.',
  'Call it when the user wants a downloadable Excel workbook (multi-sheet tables, reports, trackers).',
  'Pass sheets as arrays of rows (each row is an array of cell values). Keep sheets ≤ 10, rows ≤ 2000, cols ≤ 50.',
  'For plain CSV/TSV text files, prefer create_file instead.',
  'Never claim an Excel file was created unless create_spreadsheet returned ok:true.',
].join(' ');

export function parseCreateSpreadsheetArgs(rawArguments: string): {
  filename: string;
  sheets: SpreadsheetSheetInput[];
  error?: string;
} {
  let args: {
    filename?: string;
    name?: string;
    sheets?: unknown;
    rows?: unknown;
  } = {};
  try {
    args = JSON.parse(rawArguments || '{}') || {};
  } catch {
    return { filename: 'workbook.xlsx', sheets: [], error: 'Invalid JSON arguments' };
  }

  let filename = sanitizeGeneratedFilename(
    String(args.filename || args.name || 'workbook.xlsx'),
  );
  if (!/\.xlsx$/i.test(filename)) {
    filename = `${filename.replace(/\.[^.]+$/, '') || 'workbook'}.xlsx`;
  }

  const sheetsIn: SpreadsheetSheetInput[] = [];
  if (Array.isArray(args.sheets)) {
    for (const item of args.sheets.slice(0, CREATE_SPREADSHEET_MAX_SHEETS)) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as { name?: unknown; rows?: unknown; data?: unknown };
      sheetsIn.push({
        name: String(rec.name || `Sheet${sheetsIn.length + 1}`),
        rows: Array.isArray(rec.rows)
          ? (rec.rows as unknown[][])
          : Array.isArray(rec.data)
            ? (rec.data as unknown[][])
            : [],
      });
    }
  } else if (Array.isArray(args.rows)) {
    sheetsIn.push({ name: 'Sheet1', rows: args.rows as unknown[][] });
  }

  if (!sheetsIn.length || sheetsIn.every((s) => !Array.isArray(s.rows) || !s.rows.length)) {
    return {
      filename,
      sheets: [],
      error: 'create_spreadsheet requires sheets[].rows (non-empty)',
    };
  }

  return {
    filename,
    sheets: sheetsIn.map((s) => ({
      name: s.name,
      rows: s.rows.slice(0, CREATE_SPREADSHEET_MAX_ROWS).map((row) => {
        const cells = Array.isArray(row) ? row : [row];
        return cells.slice(0, CREATE_SPREADSHEET_MAX_COLS);
      }),
    })),
  };
}

export function createCreateSpreadsheetTool(): ChatTool {
  return {
    name: 'create_spreadsheet',
    definition: {
      type: 'function',
      function: {
        name: 'create_spreadsheet',
        description:
          'Create a real Excel .xlsx workbook and save it to the chat Output panel / Files. Prefer this over create_file for .xlsx. Pass sheets with row arrays.',
        parameters: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'File name ending in .xlsx (e.g. report.xlsx).',
            },
            sheets: {
              type: 'array',
              description: 'Workbook sheets (max 10).',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Sheet tab name.' },
                  rows: {
                    type: 'array',
                    description: 'Rows as arrays of cell values (max 2000×50).',
                    items: { type: 'array', items: {} },
                  },
                },
                required: ['rows'],
              },
            },
          },
          required: ['sheets'],
        },
      },
    },
    systemPrompt: SYSTEM,
    enabled: () => true,
    async execute({ rawArguments }, ctx) {
      const parsed = parseCreateSpreadsheetArgs(rawArguments);
      if (parsed.error) {
        ctx.send({
          tool: {
            status: 'done',
            name: 'create_spreadsheet',
            provider: 'files',
            query: parsed.filename,
            error: parsed.error,
          },
        });
        return { content: JSON.stringify({ ok: false, error: parsed.error }) };
      }

      const apiKey = String(ctx.credentials?.skillsApiKey || ctx.gateway?.apiKey || '').trim();
      if (!apiKey) {
        const message = 'create_spreadsheet requires a connected account';
        ctx.send({
          tool: {
            status: 'done',
            name: 'create_spreadsheet',
            provider: 'files',
            query: parsed.filename,
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }

      ctx.send({
        tool: {
          status: 'start',
          name: 'create_spreadsheet',
          provider: 'files',
          query: parsed.filename,
        },
      });

      try {
        const bytes = buildXlsxBytes(parsed.sheets);
        if (bytes.byteLength > MAX_XLSX_BYTES) {
          throw new Error(`Workbook too large (max ${MAX_XLSX_BYTES} bytes)`);
        }
        const extractText = sheetsToExtractText(parsed.sheets);
        const uploaded = await uploadGatewayFile({
          apiKey,
          bytes,
          filename: parsed.filename,
          mime: SPREADSHEET_MIME,
          purpose: 'assistants',
          extractText,
        });

        const file = {
          id: uploaded.id,
          name: uploaded.filename || parsed.filename,
          mimeType: SPREADSHEET_MIME,
          size: uploaded.bytes || bytes.byteLength,
          url: `/api/files/${encodeURIComponent(uploaded.id)}`,
          content:
            extractText.length > 24_000
              ? `${extractText.slice(0, 24_000)}\n\n[…truncated for chat preview; full text is on the file extract]`
              : extractText,
          createdAt: Date.now(),
        };

        ctx.send({ file_created: file });
        ctx.send({
          tool: {
            status: 'done',
            name: 'create_spreadsheet',
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
        const message = err instanceof Error ? err.message : 'create_spreadsheet failed';
        ctx.send({
          tool: {
            status: 'done',
            name: 'create_spreadsheet',
            provider: 'files',
            query: parsed.filename,
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
    },
  };
}
