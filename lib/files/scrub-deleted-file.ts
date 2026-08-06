/**
 * When an account file is deleted, scrub its ids out of local chat sessions
 * (structured cards + content markers) so UI / model prompts stay in sync.
 */

import type { ChatSession, Message } from '@/lib/chat/types';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isEmptyAssistantShell(m: Message): boolean {
  return (
    m.role === 'assistant' &&
    !m.content?.trim() &&
    !m.images?.length &&
    !m.files?.length &&
    !m.views?.length &&
    !m.reasoning &&
    !m.toolRuns?.length
  );
}

function scrubEmptyMarkerBlock(raw: string, marker: string): string {
  const parts: string[] = [];
  let rest = raw;
  while (rest.length) {
    const idx = rest.indexOf(marker);
    if (idx < 0) {
      parts.push(rest);
      break;
    }
    parts.push(rest.slice(0, idx));
    const fromMarker = rest.slice(idx);
    // Block runs until a blank line that starts a new paragraph, or EOF.
    const afterMarker = fromMarker.slice(marker.length);
    const blank = afterMarker.search(/\n\n(?!\-)/);
    const block =
      blank >= 0
        ? fromMarker.slice(0, marker.length + blank)
        : fromMarker;
    const remainder =
      blank >= 0 ? fromMarker.slice(marker.length + blank) : '';
    const hasItemLine = /(?:^|\n)\- /.test(block);
    if (hasItemLine) {
      parts.push(block);
    }
    rest = remainder;
  }
  return parts.join('');
}

/** Remove attachment / history-ref / archive lines that mention this fileId. */
export function scrubFileIdFromContent(content: string, fileId: string): string {
  const id = String(fileId || '').trim();
  const raw = String(content || '');
  if (!id || !raw) return raw;
  const esc = escapeRegExp(id);
  const escEnc = escapeRegExp(encodeURIComponent(id));

  let next = raw;

  // Full first-turn attachment body for this id.
  next = next.replace(
    new RegExp(
      `\\[Attached File:[^\\]]*\\]\\s*\\(stored fileId:\\s*${esc}\\)\\s*\\n?[\\s\\S]*?(?=\\n\\n---\\n\\n|\\n\\n\\[Attached File:|$)`,
      'g',
    ),
    '',
  );

  // Collapsed / assistant history lines: `- name (fileId: id)…`
  next = next.replace(
    new RegExp(`(?:^|\\n)\\- [^\\n]*\\(fileId:\\s*${esc}\\)[^\\n]*`, 'g'),
    (m) => (m.startsWith('\n') ? '\n' : ''),
  );

  // 【原图存档】 / path lines pointing at this file.
  next = next.replace(
    new RegExp(
      `(?:^|\\n)\\- (?:图\\s*\\d+\\s+)?(?:\\/api\\/files\\/${esc}|\\/api\\/files\\/${escEnc})\\s*(?=\\n|$)`,
      'g',
    ),
    (m) => (m.startsWith('\n') ? '\n' : ''),
  );

  // 【历史图片引用（未转写）】 item lines (generated at send time but may be copied).
  next = next.replace(
    new RegExp(
      `(?:^|\\n)\\- 图\\s*\\d+:\\s*(?:\\/api\\/files\\/${esc}|\\/api\\/files\\/${escEnc})\\s*(?=\\n|$)`,
      'g',
    ),
    (m) => (m.startsWith('\n') ? '\n' : ''),
  );

  next = scrubEmptyMarkerBlock(next, '【历史文件引用】');
  next = scrubEmptyMarkerBlock(next, '【原图存档】');
  next = scrubEmptyMarkerBlock(next, '【历史图片引用（未转写）】');

  return next.replace(/\n{3,}/g, '\n\n').trim();
}

export function scrubFileIdFromMessage(message: Message, fileId: string): Message {
  const id = String(fileId || '').trim();
  if (!id) return message;

  // Keep Output / timeline cards as production records; mark storage gone.
  const files = message.files?.map((f) =>
    f.id === id ? { ...f, unavailable: true } : f,
  );
  const images = message.images?.map((img) =>
    img.fileId === id ? { ...img, unavailable: true } : img,
  );
  const toolRuns = message.toolRuns?.map((run) => {
    if (!run.results?.length) return run;
    const results = run.results.filter((r) => {
      const url = String(r.url || '');
      if (!url) return true;
      return (
        !url.includes(`/api/files/${id}`) &&
        !url.includes(`/api/files/${encodeURIComponent(id)}`)
      );
    });
    return results.length === run.results.length ? run : { ...run, results };
  });

  return {
    ...message,
    // Drop prompt markers that would invite file_read / image_understand on ghosts.
    content: scrubFileIdFromContent(message.content || '', id),
    files: files?.length ? files : undefined,
    images: images?.length ? images : undefined,
    toolRuns,
  };
}

function scrubWebSources(
  sources: ChatSession['webSources'],
  fileId: string,
): ChatSession['webSources'] {
  if (!sources?.length) return sources;
  const id = String(fileId || '').trim();
  const urls = new Set([
    `/api/files/${id}`,
    `/api/files/${encodeURIComponent(id)}`,
  ]);
  const next = sources.filter((s) => !urls.has(String(s.url || '').split(/[?#]/)[0]));
  return next.length ? next : undefined;
}

/** Drop a deleted account file from every local session (cards + text refs). */
export function scrubFileIdFromSessions(
  sessions: ChatSession[],
  fileId: string,
): ChatSession[] {
  const id = String(fileId || '').trim();
  if (!id) return sessions;
  const now = Date.now();
  return sessions.map((s) => {
    const messages = s.messages
      .map((m) => scrubFileIdFromMessage(m, id))
      .filter((m) => !isEmptyAssistantShell(m));
    return {
      ...s,
      messages,
      webSources: scrubWebSources(s.webSources, id),
      updatedAt: now,
    };
  });
}

/** Collect gateway file ids still referenced by local sessions. */
export function collectReferencedAccountFileIds(sessions: ChatSession[]): string[] {
  const ids = new Set<string>();
  const take = (raw: string | undefined) => {
    const id = String(raw || '').trim();
    if (/^file-[a-zA-Z0-9_-]+$/i.test(id)) ids.add(id);
  };
  for (const s of sessions || []) {
    for (const m of s.messages || []) {
      for (const f of m.files || []) take(f.id);
      for (const img of m.images || []) take(img.fileId);
      for (const step of m.activity || []) {
        if (step.kind === 'file') take(step.fileId);
      }
      const content = String(m.content || '');
      const re =
        /(?:fileId:\s*|stored fileId:\s*|\/api\/files\/)(file-[a-zA-Z0-9_-]+)/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) take(match[1]);
    }
    for (const src of s.webSources || []) {
      const url = String(src.url || '');
      const m = url.match(/\/api\/files\/(file-[a-zA-Z0-9_-]+)/i);
      if (m) take(m[1]);
    }
  }
  return [...ids];
}

/**
 * Account file ids that appear in doomedSessions (and optional extras such as
 * composer pending uploads) but nowhere in keepSessions — safe to delete from
 * storage when removing a conversation.
 */
export function accountFileIdsExclusiveToSessions(
  doomedSessions: ChatSession[],
  keepSessions: ChatSession[],
  extraFileIds: Iterable<string> = [],
): string[] {
  const keep = new Set(collectReferencedAccountFileIds(keepSessions));
  const doomed = new Set(collectReferencedAccountFileIds(doomedSessions));
  for (const raw of extraFileIds) {
    const id = String(raw || '').trim();
    if (/^file-[a-zA-Z0-9_-]+$/i.test(id)) doomed.add(id);
  }
  return [...doomed].filter((id) => !keep.has(id));
}

/**
 * Scrub refs whose file ids are absent from the account file list.
 * Call only when the listing is known-complete (e.g. page size not full).
 */
export function scrubMissingAccountFiles(
  sessions: ChatSession[],
  existingFileIds: Iterable<string>,
): ChatSession[] {
  const existing = new Set(
    [...existingFileIds].map((id) => String(id || '').trim()).filter(Boolean),
  );
  const missing = collectReferencedAccountFileIds(sessions).filter(
    (id) => !existing.has(id),
  );
  if (!missing.length) return sessions;
  let next = sessions;
  for (const id of missing) {
    next = scrubFileIdFromSessions(next, id);
  }
  return next;
}
