/**
 * Parse / collapse `[Attached File: …]` blocks in user message content.
 *
 * First-turn attaches keep full extracted text (so the model can answer without
 * an empty tool round). Older turns — both in the model prompt and in persisted
 * session JSON — collapse to 【历史文件引用】 + short preview + fileId; models
 * re-read via `file_read` → chat-api extract sidecar.
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

/**
 * Directive bodies are single-line `(stored server-side … call file_read …)`
 * hints, not real file text. They must not be cached as extracts — otherwise
 * file_read treats the pointer as the document when the sidecar is missing.
 *
 * Narrow on purpose (KTD3): only deterministic shape — single line, short,
 * bracket-wrapped, contains the exact phrase `call file_read`, no markdown
 * structure chars. Real user content (markdown excerpts, conversation about
 * file_read usage) fails at least one gate.
 */
export function isDirectiveBody(body: string): boolean {
  const t = String(body || '').trim();
  if (!t.startsWith('(') || !t.endsWith(')')) return false;
  if (t.length >= 200) return false;
  if (!/call file_read/.test(t)) return false;
  if (/[\n\t]/.test(t)) return false;
  if (/[|#*`]/.test(t)) return false;
  return true;
}

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
 * Lightweight refs for assistant-delivered files (book_download / create_file /
 * create_spreadsheet) — same marker family as collapsed user attachments so
 * file_read can open them on demand (image-ref pattern for documents).
 */
export function formatChatFileHistoryRefs(
  files: Array<{ id?: string; name?: string; mimeType?: string; unavailable?: boolean }>,
): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const f of files || []) {
    if (f.unavailable) continue;
    const fileId = String(f.id || '').trim();
    if (!fileId || seen.has(fileId)) continue;
    seen.add(fileId);
    const name = String(f.name || fileId).trim() || fileId;
    const mime = String(f.mimeType || '').trim();
    const mimePart = mime ? ` [${mime}]` : '';
    lines.push(`- ${name} (fileId: ${fileId})${mimePart}`);
  }
  if (!lines.length) return '';
  return [
    HISTORY_FILE_REF_MARKER,
    ...lines,
    '如需全文请调用 file_read（传入 file_id）。这些文件已保存在本对话 / Files，无需用户重新上传。',
  ].join('\n');
}

/**
 * Replace full attached-file bodies with describing + fileId refs.
 * Leaves the trailing user ask (after `---`) untouched when present.
 *
 * `onlyWithFileId`: keep full bodies that have no fileId (cannot re-read via
 * sidecar / file_read) — used for session persistence.
 */
export function collapseAttachedFileBlocksForHistory(
  content: string,
  opts?: { previewChars?: number; onlyWithFileId?: boolean },
): string {
  const raw = String(content || '');
  const blocks = parseAttachedFileBlocks(raw);
  if (!blocks.length) return raw;

  const previewChars = opts?.previewChars ?? DEFAULT_PREVIEW_CHARS;
  const onlyWithFileId = Boolean(opts?.onlyWithFileId);
  const toCollapse = onlyWithFileId ? blocks.filter((b) => Boolean(b.fileId)) : blocks;
  if (!toCollapse.length) return raw;

  // Replace from the end so earlier offsets stay valid when only some blocks collapse.
  let result = raw;
  for (let i = toCollapse.length - 1; i >= 0; i--) {
    const b = toCollapse[i];
    const replacement = formatAttachedFileHistoryRef(b, previewChars);
    result = `${result.slice(0, b.start)}${replacement}${result.slice(b.end)}`;
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function messageTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n');
  }
  return '';
}

/**
 * Persist/sync helper: collapse full attached-file extracts in user messages.
 * Keeps the latest user turn intact when `keepLastUserFull` so Retry still has
 * first-turn text; older turns become 【历史文件引用】 + fileId (sidecar re-read).
 */
export function collapseAttachedFileBodiesInMessages<
  T extends { role?: string; content?: unknown },
>(
  messages: T[],
  opts?: {
    keepLastUserFull?: boolean;
    onlyWithFileId?: boolean;
    previewChars?: number;
  },
): T[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  let lastUserIdx = -1;
  if (opts?.keepLastUserFull) {
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user') lastUserIdx = i;
    }
  }

  let changed = false;
  const next = messages.map((m, i) => {
    if (m.role !== 'user') return m;
    if (opts?.keepLastUserFull && i === lastUserIdx) return m;
    const text = messageTextContent(m.content);
    if (!text.includes('[Attached File:')) return m;
    const collapsed = collapseAttachedFileBlocksForHistory(text, {
      previewChars: opts?.previewChars,
      onlyWithFileId: opts?.onlyWithFileId,
    });
    if (collapsed === text) return m;
    changed = true;
    return { ...m, content: collapsed };
  });
  return changed ? next : messages;
}

/** Bubble/UI: never dump full PDF/DOCX/Excel extract into the chat transcript. */
export function attachedFilesForUserBubbleDisplay(content: string): string {
  return collapseAttachedFileBlocksForHistory(String(content || ''));
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
      // A directive-shaped pointer body ("call file_read with file_id=…") is not
      // the document itself — skip so file_read doesn't treat it as the extract.
      if (isDirectiveBody(block.body)) continue;
      // Prefer the longest extract if the same file appears twice.
      const prev = out[block.fileId];
      if (prev && prev.text.length >= block.body.length) continue;
      out[block.fileId] = { name: block.name, text: block.body };
    }
  }
  return out;
}

export function messagesHaveAttachedFiles(
  messages: Array<{
    role?: string;
    content?: unknown;
    files?: Array<{ id?: string; unavailable?: boolean }>;
  }>,
): boolean {
  for (const m of messages) {
    if (
      Array.isArray(m.files) &&
      m.files.some((f) => String(f?.id || '').trim() && !f.unavailable)
    ) {
      return true;
    }
    const text = messageTextContent(m.content);
    // User attaches + assistant 【历史文件引用】 (book_download / create_file).
    if (m.role === 'user' || m.role === 'assistant' || m.role === 'tool') {
      if (contentHasAttachedFiles(text)) return true;
      if (text.includes('(fileId:') && /file_read|历史文件引用/.test(text)) return true;
    }
  }
  return false;
}
