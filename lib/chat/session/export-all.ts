/**
 * Build a portable account data export (sessions + memories).
 * Pure helpers — UI owns hydrate gating / download / error toast timing.
 */

import type { ChatSession } from '@/lib/chat/types';
import { serializeMemoriesMarkdown } from '@/lib/memories/markdown';
import type { MemoryItem } from '@/lib/memories/types';

export const ACCOUNT_EXPORT_VERSION = 1 as const;
/** Single-page fetch size; if the API returns exactly this many, export may be truncated. */
export const MEMORIES_EXPORT_PAGE_LIMIT = 200;

export type AccountExportScope = 'guest' | 'account';

export type AccountDataExport = {
  version: typeof ACCOUNT_EXPORT_VERSION;
  exportedAt: string;
  scope: AccountExportScope;
  sessions: ChatSession[];
  memories: MemoryItem[];
  /** Human-editable MEMORY.md snapshot of `memories` (empty for guest). */
  memoryMarkdown: string;
  completeness: {
    sessionsSource: 'local' | 'local+cloud';
    memoriesComplete: boolean;
    warnings: string[];
  };
};

export type FetchMemoriesForExportResult =
  | { ok: true; memories: MemoryItem[]; mayBeTruncated: boolean }
  | { ok: false; error: string };

/** Deep-clone sessions for backup — does NOT apply cloud-sync scrubbing. */
export function cloneSessionsForExport(sessions: ChatSession[]): ChatSession[] {
  const list = Array.isArray(sessions) ? sessions : [];
  try {
    return structuredClone(list);
  } catch {
    return JSON.parse(JSON.stringify(list)) as ChatSession[];
  }
}

export async function fetchMemoriesForExport(
  fetchImpl: typeof fetch = fetch,
  limit: number = MEMORIES_EXPORT_PAGE_LIMIT,
): Promise<FetchMemoriesForExportResult> {
  try {
    const res = await fetchImpl(`/api/memories?limit=${limit}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: String(json?.error || json?.message || `HTTP ${res.status}`),
      };
    }
    if (!Array.isArray(json?.data)) {
      return { ok: false, error: 'Invalid memories response' };
    }
    const memories = json.data as MemoryItem[];
    return {
      ok: true,
      memories,
      mayBeTruncated: memories.length >= limit,
    };
  } catch (cause: unknown) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'Failed to load memories',
    };
  }
}

export function buildAccountDataExport(opts: {
  sessions: ChatSession[];
  memories: MemoryItem[];
  scope: AccountExportScope;
  sessionsSource: 'local' | 'local+cloud';
  memoriesComplete: boolean;
  warnings?: string[];
  exportedAt?: Date;
}): AccountDataExport {
  const at = opts.exportedAt ?? new Date();
  const memories = Array.isArray(opts.memories) ? opts.memories : [];
  const warnings = [...(opts.warnings || [])];
  if (opts.scope === 'guest' && memories.length === 0) {
    // Guest has no account memories store — keep payload honest without a warning spam.
  } else if (!opts.memoriesComplete) {
    warnings.push('Memories list may be incomplete (API page limit reached).');
  }
  return {
    version: ACCOUNT_EXPORT_VERSION,
    exportedAt: at.toISOString(),
    scope: opts.scope,
    sessions: cloneSessionsForExport(opts.sessions),
    memories,
    memoryMarkdown:
      opts.scope === 'guest' ? '' : serializeMemoriesMarkdown(memories),
    completeness: {
      sessionsSource: opts.sessionsSource,
      memoriesComplete: opts.memoriesComplete,
      warnings,
    },
  };
}

export function accountExportFilename(exportedAt: Date = new Date()): string {
  const stamp = exportedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `llm-christmas-export-${stamp}.json`;
}

export function accountExportJson(payload: AccountDataExport): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}
