/**
 * Parse / collapse `[Attached File: …]` blocks in user message content.
 *
 * First-turn attaches keep full extracted text. Older turns are collapsed to a
 * short describing + fileId marker so follow-up prompts stay cheap; models can
 * re-read via `file_read`.
 */

export const HISTORY_FILE_REF_MARKER = '【历史文件引用】';

const ATTACHED_FILE_START =
  /\[Attached File: ([^\]]+)\](?:\s*\(stored fileId:\s*([^)]+)\))?/g;

export type AttachedFileBlock = {
  name: string;
  fileId?: string;
  body: string;
  /** Absolute offsets into the original content string. */
  start: number;
  end: number;
};

export type FileExtractEntry = {
  name: string;
  text: string;
};

const DEFAULT_PREVIEW_CHARS = 400;

/** Split user content into attached-file blocks (order preserved). */
export function parseAttachedFileBlocks(content: string): AttachedFileBlock[] {
  const raw = String(content || '');
  if (!raw.includes('[Attached File:')) return [];

  const headers: Array<{ name: string; fileId?: string; headerStart: number; bodyStart: number }> =
    [];
  ATTACHED_FILE_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTACHED_FILE_START.exec(raw)) !== null) {
    const name = String(m[1] || '').trim();
    const fileId = String(m[2] || '').trim() || undefined;
    const headerStart = m.index;
    const bodyStart = m.index + m[0].length;
    // Body begins after optional whitespace/newline following the header.
    const nl = raw.slice(bodyStart).match(/^\s*\n/);
    headers.push({
      name,
      fileId,
      headerStart,
      bodyStart: bodyStart + (nl ? nl[0].length : 0),
    });
  }
  if (!headers.length) return [];

  const blocks: AttachedFileBlock[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const nextStart = i + 1 < headers.length ? headers[i + 1].headerStart : raw.length;
    // Stop before the user ask separator `---` or the next attached file.
    let bodyEnd = nextStart;
    const slice = raw.slice(h.bodyStart, nextStart);
    const sep = slice.search(/\n\n---\n\n/);
    if (sep >= 0) bodyEnd = h.bodyStart + sep;
    const body = raw.slice(h.bodyStart, bodyEnd).trim();
    // Skip already-collapsed history markers (no real body to cache).
    if (body.startsWith(HISTORY_FILE_REF_MARKER)) continue;
    blocks.push({
      name: h.name,
      fileId: h.fileId,
      body,
      start: h.headerStart,
      end: bodyEnd,
    });
  }
  return blocks;
}

export function previewAttachedFileBody(
  body: string,
  previewChars = DEFAULT_PREVIEW_CHARS,
): string {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= previewChars) return t;
  return `${t.slice(0, previewChars)}…`;
}

export function formatAttachedFileHistoryRef(
  block: Pick<AttachedFileBlock, 'name' | 'fileId' | 'body'>,
  previewChars = DEFAULT_PREVIEW_CHARS,
): string {
  const preview = previewAttachedFileBody(block.body, previewChars);
  const idPart = block.fileId ? ` (fileId: ${block.fileId})` : '';
  const line = preview
    ? `- ${block.name}${idPart}: ${preview}`
    : `- ${block.name}${idPart}`;
  const hint = block.fileId
    ? '如需全文请调用 file_read（传入 file_id）。'
    : '（无 fileId，无法通过 file_read 重读；正文仅在首次附带时完整提供。）';
  return `${HISTORY_FILE_REF_MARKER}\n${line}\n${hint}`;
}

/**
 * Replace full attached-file bodies with describing + fileId refs.
 * Leaves the trailing user ask (after `---`) untouched when present.
 */
export function collapseAttachedFileBlocksForHistory(
  content: string,
  opts?: { previewChars?: number },
): string {
  const raw = String(content || '');
  const blocks = parseAttachedFileBlocks(raw);
  if (!blocks.length) return raw;

  const previewChars = opts?.previewChars ?? DEFAULT_PREVIEW_CHARS;
  // Rebuild: everything before first block, then collapsed refs, then tail after last block.
  const head = raw.slice(0, blocks[0].start).trimEnd();
  const collapsed = blocks
    .map((b) => formatAttachedFileHistoryRef(b, previewChars))
    .join('\n\n');
  const tail = raw.slice(blocks[blocks.length - 1].end).replace(/^\s*\n\n---\n\n/, '\n\n---\n\n');
  const mid = [collapsed, tail.trimStart() ? tail : ''].filter(Boolean).join('\n\n');
  return [head, mid].filter(Boolean).join('\n\n').trim();
}

export function contentHasAttachedFiles(content: string): boolean {
  const c = String(content || '');
  return c.includes('[Attached File:') || c.includes(HISTORY_FILE_REF_MARKER);
}

/** Collect fileId → extracted text from message contents (before history collapse). */
export function collectFileExtractsFromMessages(
  messages: Array<{ role?: string; content?: unknown }>,
): Record<string, FileExtractEntry> {
  const out: Record<string, FileExtractEntry> = {};
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const text =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
              .map((p: any) => p.text)
              .join('\n')
          : '';
    for (const block of parseAttachedFileBlocks(text)) {
      if (!block.fileId || !block.body) continue;
      // Prefer the longest extract if the same file appears twice.
      const prev = out[block.fileId];
      if (prev && prev.text.length >= block.body.length) continue;
      out[block.fileId] = { name: block.name, text: block.body };
    }
  }
  return out;
}

export function messagesHaveAttachedFiles(
  messages: Array<{ role?: string; content?: unknown }>,
): boolean {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const text =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
              .map((p: any) => p.text)
              .join('\n')
          : '';
    if (contentHasAttachedFiles(text)) return true;
  }
  return false;
}
