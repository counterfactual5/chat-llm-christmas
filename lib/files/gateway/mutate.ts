/** chat-api office mutate / restore helpers (account Files SSOT). */

import { filesGatewayBaseURL } from './base';

export type OfficeMutateResult = {
  ok: boolean;
  id: string;
  bytes: number;
  content_rev: number;
  filename: string;
  mime: string;
  snapshot_id: string | null;
  kind?: string;
  diff?: unknown[];
  warnings?: string[];
  extract_partial?: boolean;
  extract_error?: string | null;
  error?: string;
  code?: string;
};

export type OfficeRestoreResult = {
  id: string;
  bytes: number;
  content_rev: number;
  filename: string;
  mime: string;
  restored_snapshot_id: string;
  safety_snapshot_id: string | null;
  extract_partial?: boolean;
  extract_error?: string | null;
  error?: string;
  code?: string;
};

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Apply constrained office ops on chat-api (auto-apply + snapshot). */
export async function mutateGatewayOfficeFile(opts: {
  apiKey: string;
  baseURL?: string;
  fileId: string;
  ops: unknown[];
}): Promise<OfficeMutateResult> {
  const baseURL = (opts.baseURL || filesGatewayBaseURL()).replace(/\/$/, '');
  const res = await fetch(
    `${baseURL}/files/${encodeURIComponent(opts.fileId)}/office-mutate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ops: opts.ops }),
    },
  );
  const data = await parseJson(res);
  if (!res.ok) {
    const message =
      (typeof data.error === 'object' && data.error && (data.error as { message?: string }).message) ||
      (typeof data.error === 'string' ? data.error : null) ||
      (typeof data.message === 'string' ? data.message : null) ||
      `office-mutate HTTP ${res.status}`;
    throw Object.assign(new Error(String(message)), {
      status: res.status,
      code: typeof data.code === 'string' ? data.code : undefined,
    });
  }
  return {
    ok: true,
    id: String(data.id || opts.fileId),
    bytes: typeof data.bytes === 'number' ? data.bytes : 0,
    content_rev: typeof data.content_rev === 'number' ? data.content_rev : 0,
    filename: String(data.filename || ''),
    mime: String(data.mime || 'application/octet-stream'),
    snapshot_id: data.snapshot_id ? String(data.snapshot_id) : null,
    kind: data.kind ? String(data.kind) : undefined,
    diff: Array.isArray(data.diff) ? data.diff : [],
    warnings: Array.isArray(data.warnings)
      ? data.warnings.map((w) => String(w))
      : [],
    extract_partial: Boolean(data.extract_partial),
    extract_error: data.extract_error ? String(data.extract_error) : null,
  };
}

/** Restore a pre-mutate snapshot on chat-api. */
export async function restoreGatewayOfficeFile(opts: {
  apiKey: string;
  baseURL?: string;
  fileId: string;
  snapshotId: string;
}): Promise<OfficeRestoreResult> {
  const baseURL = (opts.baseURL || filesGatewayBaseURL()).replace(/\/$/, '');
  const res = await fetch(
    `${baseURL}/files/${encodeURIComponent(opts.fileId)}/restore`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ snapshot_id: opts.snapshotId }),
    },
  );
  const data = await parseJson(res);
  if (!res.ok) {
    const message =
      (typeof data.error === 'object' && data.error && (data.error as { message?: string }).message) ||
      (typeof data.error === 'string' ? data.error : null) ||
      (typeof data.message === 'string' ? data.message : null) ||
      `restore HTTP ${res.status}`;
    throw Object.assign(new Error(String(message)), {
      status: res.status,
      code: typeof data.code === 'string' ? data.code : undefined,
    });
  }
  return {
    id: String(data.id || opts.fileId),
    bytes: typeof data.bytes === 'number' ? data.bytes : 0,
    content_rev: typeof data.content_rev === 'number' ? data.content_rev : 0,
    filename: String(data.filename || ''),
    mime: String(data.mime || 'application/octet-stream'),
    restored_snapshot_id: String(data.restored_snapshot_id || opts.snapshotId),
    safety_snapshot_id: data.safety_snapshot_id
      ? String(data.safety_snapshot_id)
      : null,
    extract_partial: Boolean(data.extract_partial),
    extract_error: data.extract_error ? String(data.extract_error) : null,
  };
}
