/**
 * xlsx_extract — open a .xlsx/.xls as specialized `xlsx.table` view.
 *
 * Model tool JSON stays separate from the UI `view_created` SSE event.
 */

import { filesGatewayBaseURL } from '@/lib/files/gateway';
import {
  VIEW_TABLE_MAX_COLS,
  VIEW_TABLE_MAX_ROWS,
  workbookBytesToXlsxTableViewData,
} from '@/lib/files/spreadsheet';
import { normalizeFileId } from '@/lib/tools/file-read/tool';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';
import type { ToolViewPayload, XlsxTableViewData } from '@/lib/tools/views/types';

const MAX_MODEL_CHARS = 12_000;

function viewId(): string {
  return `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function parseXlsxExtractArgs(
  rawArgs: string,
  fallback: string,
): { fileId: string; sheet: string } {
  try {
    const args = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const fileId = String(
        args.file_id || args.fileId || args.id || args.path || args.url || '',
      ).trim();
      const sheet = String(args.sheet || args.sheet_name || args.sheetName || '').trim();
      if (fileId) return { fileId: normalizeFileId(fileId), sheet };
    }
  } catch {
    /* fall through */
  }
  const bare = String(rawArgs || fallback || '').trim();
  if (bare) return { fileId: normalizeFileId(bare), sheet: '' };
  return { fileId: '', sheet: '' };
}

async function fetchGatewaySpreadsheetBytes(
  fileId: string,
  apiKey: string | undefined,
): Promise<
  | { ok: true; name: string; mime: string; buffer: ArrayBuffer }
  | { ok: false; error: string }
> {
  if (!apiKey) {
    return { ok: false, error: 'xlsx_extract requires a logged-in account.' };
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
  const looksSheet =
    /\.(xlsx|xls)$/i.test(filename) ||
    ct.includes('spreadsheetml') ||
    ct.includes('ms-excel') ||
    ct === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (!looksSheet) {
    return {
      ok: false,
      error: `File ${filename} does not look like a spreadsheet (${ct || 'unknown type'}).`,
    };
  }

  return {
    ok: true,
    name: filename,
    mime: ct || mime,
    buffer,
  };
}

function tablePreviewText(data: XlsxTableViewData): string {
  const lines: string[] = [];
  if (data.sheetName) lines.push(`Sheet: ${data.sheetName}`);
  if (data.headers?.length) lines.push(data.headers.join('\t'));
  for (const row of data.rows.slice(0, 40)) {
    lines.push(row.join('\t'));
  }
  return lines.join('\n').trim();
}

const XLSX_EXTRACT_SYSTEM_PROMPT = [
  'You also have an xlsx_extract tool that opens a specialized side-panel table view of a .xlsx/.xls.',
  'Call xlsx_extract with a gateway file_id (optional sheet name or 0-based index) when the user wants to inspect a spreadsheet in the UI.',
  'This is NOT create_spreadsheet and NOT a full Excel editor. Prefer file_read / uploaded extracts when you only need TSV text for reasoning.',
  'Never claim a view was opened unless xlsx_extract returned ok:true.',
].join(' ');

export function createXlsxExtractTool(): ChatTool {
  return {
    name: 'xlsx_extract',
    definition: {
      type: 'function',
      function: {
        name: 'xlsx_extract',
        description:
          'Open a .xlsx/.xls attachment as a specialized chat table view (xlsx.table). Pass gateway file_id; optional sheet name or 0-based index (default first sheet).',
        parameters: {
          type: 'object',
          properties: {
            file_id: {
              type: 'string',
              description:
                'Gateway file id from 【历史文件引用】 / (fileId: …) / uploaded spreadsheet',
            },
            sheet: {
              type: 'string',
              description: 'Sheet name or 0-based index (optional; default first sheet)',
            },
          },
          required: ['file_id'],
        },
      },
    },
    systemPrompt: XLSX_EXTRACT_SYSTEM_PROMPT,
    enabled: () => true,
    async execute({ rawArguments, fallbackQuery }, ctx: ToolRuntimeContext) {
      const { fileId, sheet } = parseXlsxExtractArgs(
        rawArguments,
        fallbackQuery || ctx.userAsk,
      );
      if (!fileId) {
        return {
          content: JSON.stringify({ ok: false, error: 'file_id is required' }),
        };
      }

      const query = fileId.slice(0, 80);
      ctx.send({
        tool: {
          status: 'start',
          name: 'xlsx_extract',
          query,
          provider: 'xlsx-extract',
        },
      });

      try {
        const fetched = await fetchGatewaySpreadsheetBytes(
          fileId,
          ctx.credentials?.skillsApiKey || ctx.gateway?.apiKey,
        );
        if (!fetched.ok) {
          ctx.send({
            tool: {
              status: 'done',
              name: 'xlsx_extract',
              query,
              provider: 'xlsx-extract',
              results: [],
              error: fetched.error,
            },
          });
          return { content: JSON.stringify({ ok: false, error: fetched.error }) };
        }

        const parsed = workbookBytesToXlsxTableViewData(fetched.buffer, {
          sheet: sheet || undefined,
          firstRowAsHeaders: true,
          maxRows: VIEW_TABLE_MAX_ROWS,
          maxCols: VIEW_TABLE_MAX_COLS,
        });
        const tableData: XlsxTableViewData = {
          sheetName: parsed.sheetName,
          headers: parsed.headers,
          rows: parsed.rows,
        };

        const payload: ToolViewPayload = {
          id: viewId(),
          viewType: 'xlsx.table',
          title: fetched.name,
          sourceFileId: fileId,
          sourceFileName: fetched.name,
          createdAt: Date.now(),
          data: tableData,
        };

        ctx.send({ view_created: payload });

        const previewText = tablePreviewText(tableData);
        const truncated = previewText.length > MAX_MODEL_CHARS;

        ctx.send({
          tool: {
            status: 'done',
            name: 'xlsx_extract',
            query,
            provider: 'xlsx-extract',
            results: [
              {
                title: fetched.name,
                url: `/api/files/${encodeURIComponent(fileId)}`,
                snippet: previewText.slice(0, 240),
              },
            ],
          },
        });

        return {
          content: JSON.stringify({
            ok: true,
            view_id: payload.id,
            view_type: payload.viewType,
            file_id: fileId,
            name: fetched.name,
            sheet: tableData.sheetName,
            sheet_names: parsed.sheetNames,
            row_count: tableData.rows.length,
            column_count: Math.max(
              tableData.headers?.length || 0,
              ...tableData.rows.map((r) => r.length),
              0,
            ),
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
            name: 'xlsx_extract',
            query,
            provider: 'xlsx-extract',
            results: [],
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }
    },
  };
}
