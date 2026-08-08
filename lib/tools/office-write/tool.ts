/**
 * office_write / office_rollback — mutate existing Office fileId on chat-api.
 * Auto-apply + snapshot; never claim success without ok:true.
 */

import { mutateGatewayOfficeFile, restoreGatewayOfficeFile } from '@/lib/files/gateway/mutate';
import { normalizeFileId } from '@/lib/tools/file-read/tool';
import type { ChatTool, ToolRuntimeContext } from '@/lib/tools/registry';

const MAX_OPS = 50;

const OFFICE_WRITE_SYSTEM = [
  'You have office_write to edit an existing .docx / .pptx / .xlsx by durable file_id (same id, in place).',
  'Only call it when the user asked to change that attached/generated Office file.',
  'Prefer structured ops: replace_text; pptx_replace_on_slide; xlsx_set_cell / xlsx_set_cells; docx_set_paragraph.',
  'full_replace (content_base64) is an escape hatch — warn the user about fidelity.',
  'Never claim an edit succeeded unless office_write returned ok:true.',
  'Use office_rollback with snapshot_id from the write receipt to undo.',
].join(' ');

const OFFICE_ROLLBACK_SYSTEM = [
  'You have office_rollback to restore a prior snapshot after office_write.',
  'Pass file_id + snapshot_id from the write receipt. Never claim rollback without ok:true.',
].join(' ');

export type OfficeWriteParse =
  | { fileId: string; ops: unknown[]; error?: undefined }
  | { fileId: string; ops: unknown[]; error: string };

export function parseOfficeWriteArgs(rawArguments: string): OfficeWriteParse {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments || '{}') || {};
  } catch {
    return { fileId: '', ops: [], error: 'Invalid JSON arguments' };
  }
  const fileId = normalizeFileId(
    String(args.file_id || args.fileId || args.id || ''),
  );
  const ops = Array.isArray(args.ops) ? args.ops : [];
  if (!fileId) {
    return { fileId: '', ops, error: 'office_write requires file_id' };
  }
  if (!ops.length) {
    return { fileId, ops: [], error: 'office_write requires non-empty ops' };
  }
  if (ops.length > MAX_OPS) {
    return {
      fileId,
      ops: [],
      error: `office_write allows at most ${MAX_OPS} ops`,
    };
  }
  return { fileId, ops };
}

export function parseOfficeRollbackArgs(rawArguments: string): {
  fileId: string;
  snapshotId: string;
  error?: string;
} {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments || '{}') || {};
  } catch {
    return { fileId: '', snapshotId: '', error: 'Invalid JSON arguments' };
  }
  const fileId = normalizeFileId(
    String(args.file_id || args.fileId || args.id || ''),
  );
  const snapshotId = String(
    args.snapshot_id || args.snapshotId || '',
  ).trim();
  if (!fileId) {
    return { fileId: '', snapshotId, error: 'office_rollback requires file_id' };
  }
  if (!snapshotId) {
    return {
      fileId,
      snapshotId: '',
      error: 'office_rollback requires snapshot_id',
    };
  }
  return { fileId, snapshotId };
}

function formatDiffSnippet(diff: unknown[]): string {
  const lines: string[] = [];
  for (const item of diff.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    const op = String(d.op || '');
    if (op === 'replace_text' || op === 'pptx_replace_on_slide') {
      lines.push(
        `${op}: ${JSON.stringify(d.find)} → ${JSON.stringify(d.replace)} (${d.matches ?? '?'} matches)`,
      );
    } else if (op === 'xlsx_set_cell' || op === 'xlsx_set_cells') {
      const cells = Array.isArray(d.cells) ? d.cells : [];
      lines.push(
        `${op} @ ${d.sheet}: ${cells
          .slice(0, 4)
          .map((c) => {
            const cell = c as { cell?: string; value?: unknown };
            return `${cell.cell}=${JSON.stringify(cell.value)}`;
          })
          .join(', ')}`,
      );
    } else if (op === 'docx_set_paragraph') {
      lines.push(`docx_set_paragraph[${d.index}]: ${JSON.stringify(d.text)}`);
    } else if (op === 'full_replace') {
      lines.push(`full_replace (${d.bytes} bytes)`);
    } else {
      lines.push(op || 'op');
    }
  }
  return lines.join('\n') || 'updated';
}

function requireAccountKey(ctx: ToolRuntimeContext): string | null {
  const key = String(ctx.credentials?.skillsApiKey || '').trim();
  return key || null;
}

export function createOfficeWriteTool(): ChatTool {
  return {
    name: 'office_write',
    definition: {
      type: 'function',
      function: {
        name: 'office_write',
        description:
          'Edit an existing .docx / .pptx / .xlsx in place (same file_id). Auto-applies with a rollback snapshot. Use when the user asks to change an attached Office file.',
        parameters: {
          type: 'object',
          properties: {
            file_id: {
              type: 'string',
              description: 'Durable Files id (file-… from 【历史文件引用】).',
            },
            ops: {
              type: 'array',
              description:
                'Mutations: replace_text {find,replace,slide?,sheet?}; pptx_replace_on_slide {slide,find,replace}; xlsx_set_cell {sheet,cell,value}; xlsx_set_cells {sheet,cells:[{cell,value}]}; docx_set_paragraph {index,text}; or sole full_replace {content_base64}.',
              items: { type: 'object' },
            },
          },
          required: ['file_id', 'ops'],
        },
      },
    },
    systemPrompt: OFFICE_WRITE_SYSTEM,
    enabled: () => true,
    async execute({ rawArguments }, ctx) {
      const parsed = parseOfficeWriteArgs(rawArguments);
      if (parsed.error) {
        ctx.send({
          tool: {
            status: 'done',
            name: 'office_write',
            provider: 'office',
            query: parsed.fileId || 'office',
            error: parsed.error,
          },
        });
        return {
          content: JSON.stringify({ ok: false, error: parsed.error }),
        };
      }

      const apiKey = requireAccountKey(ctx);
      if (!apiKey) {
        // Guest / shared key must not mutate account files.
        const message = 'office_write requires a connected account';
        ctx.send({
          tool: {
            status: 'done',
            name: 'office_write',
            provider: 'office',
            query: parsed.fileId,
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }

      ctx.send({
        tool: {
          status: 'start',
          name: 'office_write',
          provider: 'office',
          query: parsed.fileId,
        },
      });

      try {
        const result = await mutateGatewayOfficeFile({
          apiKey,
          baseURL: undefined,
          fileId: parsed.fileId,
          ops: parsed.ops,
        });
        const snippet = formatDiffSnippet(result.diff || []);
        const undoBody = JSON.stringify({
          kind: 'office_undo',
          file_id: result.id,
          snapshot_id: result.snapshot_id,
          filename: result.filename,
          mime: result.mime,
          size: result.bytes,
        });
        ctx.send({
          file_updated: {
            id: result.id,
            name: result.filename,
            mimeType: result.mime,
            size: result.bytes,
            url: `/api/files/${encodeURIComponent(result.id)}`,
            createdAt: Date.now(),
            snapshotId: result.snapshot_id,
            contentRev: result.content_rev,
          },
        });
        ctx.send({
          tool: {
            status: 'done',
            name: 'office_write',
            provider: 'office',
            query: result.filename || result.id,
            results: [
              {
                title: result.filename || result.id,
                url: `/api/files/${encodeURIComponent(result.id)}`,
                snippet,
                body: undoBody,
              },
            ],
          },
        });
        return {
          content: JSON.stringify({
            ok: true,
            file_id: result.id,
            snapshot_id: result.snapshot_id,
            content_rev: result.content_rev,
            bytes: result.bytes,
            kind: result.kind,
            diff: result.diff,
            warnings: result.warnings,
            extract_partial: result.extract_partial,
            extract_error: result.extract_error,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'office_write failed';
        ctx.send({
          tool: {
            status: 'done',
            name: 'office_write',
            provider: 'office',
            query: parsed.fileId,
            error: message,
          },
        });
        return {
          content: JSON.stringify({
            ok: false,
            error: message,
            code: (err as { code?: string })?.code,
          }),
        };
      }
    },
  };
}

export function createOfficeRollbackTool(): ChatTool {
  return {
    name: 'office_rollback',
    definition: {
      type: 'function',
      function: {
        name: 'office_rollback',
        description:
          'Restore an Office file to a prior snapshot_id from office_write. Same file_id.',
        parameters: {
          type: 'object',
          properties: {
            file_id: { type: 'string' },
            snapshot_id: { type: 'string' },
          },
          required: ['file_id', 'snapshot_id'],
        },
      },
    },
    systemPrompt: OFFICE_ROLLBACK_SYSTEM,
    enabled: () => true,
    async execute({ rawArguments }, ctx) {
      const parsed = parseOfficeRollbackArgs(rawArguments);
      if (parsed.error) {
        ctx.send({
          tool: {
            status: 'done',
            name: 'office_rollback',
            provider: 'office',
            query: parsed.fileId || 'office',
            error: parsed.error,
          },
        });
        return {
          content: JSON.stringify({ ok: false, error: parsed.error }),
        };
      }

      const apiKey = requireAccountKey(ctx);
      if (!apiKey) {
        const message = 'office_rollback requires a connected account';
        ctx.send({
          tool: {
            status: 'done',
            name: 'office_rollback',
            provider: 'office',
            query: parsed.fileId,
            error: message,
          },
        });
        return { content: JSON.stringify({ ok: false, error: message }) };
      }

      ctx.send({
        tool: {
          status: 'start',
          name: 'office_rollback',
          provider: 'office',
          query: parsed.fileId,
        },
      });

      try {
        const result = await restoreGatewayOfficeFile({
          apiKey,
          fileId: parsed.fileId,
          snapshotId: parsed.snapshotId,
        });
        ctx.send({
          file_updated: {
            id: result.id,
            name: result.filename,
            mimeType: result.mime,
            size: result.bytes,
            url: `/api/files/${encodeURIComponent(result.id)}`,
            createdAt: Date.now(),
            snapshotId: result.safety_snapshot_id,
            contentRev: result.content_rev,
          },
        });
        ctx.send({
          tool: {
            status: 'done',
            name: 'office_rollback',
            provider: 'office',
            query: result.filename || result.id,
            results: [
              {
                title: result.filename || result.id,
                url: `/api/files/${encodeURIComponent(result.id)}`,
                snippet: `restored ${result.restored_snapshot_id}`,
              },
            ],
          },
        });
        return {
          content: JSON.stringify({
            ok: true,
            file_id: result.id,
            restored_snapshot_id: result.restored_snapshot_id,
            safety_snapshot_id: result.safety_snapshot_id,
            content_rev: result.content_rev,
            bytes: result.bytes,
          }),
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'office_rollback failed';
        ctx.send({
          tool: {
            status: 'done',
            name: 'office_rollback',
            provider: 'office',
            query: parsed.fileId,
            error: message,
          },
        });
        return {
          content: JSON.stringify({
            ok: false,
            error: message,
            code: (err as { code?: string })?.code,
          }),
        };
      }
    },
  };
}
