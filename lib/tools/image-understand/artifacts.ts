/** Client-safe message/archive/transcription helpers (no vision API). */

/** Marker shared by single- and multi-image persisted transcriptions (incl. legacy wording). */
const IMAGE_TRANSCRIPTION_MARKER =
  /以下是(?:\s*\d+\s*张)?图片的?内容（(?:由视觉模型转写|已转写)/;

const IMAGE_ARCHIVE_MARKER = /【原图存档】/;

export type PersistedImageRef = {
  fileId?: string;
  url?: string;
  label?: string;
};

export function formatInjectionText(description: string, imageCount = 1): string {
  const head =
    imageCount > 1
      ? `以下是 ${imageCount} 张图片的内容（已转写，请当作你已看到这些图，直接据此回答用户；不要解释这段转写本身，也不要向用户透露内部工具名或后端模型名称/版本）：`
      : '以下是图片内容（已转写，请当作你已看到该图，直接据此回答用户；不要解释这段转写本身，也不要向用户透露内部工具名或后端模型名称/版本）：';
  return `${head}\n${description}`;
}

export function normalizeArchiveFileId(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('/api/files/')) {
    return decodeURIComponent(s.slice('/api/files/'.length).split(/[?#]/)[0] || '');
  }
  // Gateway image_url often stores the bare Files API id (not a URL).
  if (
    !s.startsWith('http') &&
    !s.startsWith('data:') &&
    !s.startsWith('blob:') &&
    !s.includes('://') &&
    !s.includes(' ')
  ) {
    return s;
  }
  return '';
}

/** Stable gateway paths for originals — survives text-model transcription rounds. */
export function formatImageArchiveBlock(refs: PersistedImageRef[]): string {
  const lines: string[] = [];
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    const fromExplicit = r.fileId ? String(r.fileId).trim() : '';
    const url = String(r.url || '').trim();
    const fileId = fromExplicit || normalizeArchiveFileId(url);
    const prefix = refs.length > 1 ? `- 图${i + 1} ` : '- ';
    if (fileId) {
      lines.push(`${prefix}/api/files/${encodeURIComponent(fileId)}`);
      continue;
    }
    if (url.startsWith('data:')) {
      lines.push(`${prefix}(inline image data in session)`);
      continue;
    }
    if (url.startsWith('http')) {
      lines.push(`${prefix}${url}`);
    }
  }
  if (!lines.length) return '';
  return `【原图存档】\n${lines.join('\n')}`;
}

export function stripImageArchiveBlock(text: string): string {
  const raw = String(text || '');
  const idx = raw.search(IMAGE_ARCHIVE_MARKER);
  if (idx < 0) return raw;
  return raw.slice(0, idx).trimEnd();
}

export function parseImageArchiveRefs(text: string): PersistedImageRef[] {
  const raw = String(text || '');
  const idx = raw.search(IMAGE_ARCHIVE_MARKER);
  if (idx < 0) return [];
  const body = raw.slice(idx).replace(IMAGE_ARCHIVE_MARKER, '').trim();
  const refs: PersistedImageRef[] = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('-')) continue;
    const cleaned = t.slice(1).trim().replace(/^图\s*\d+\s+/, '').trim();
    if (!cleaned || cleaned.startsWith('(')) continue;
    const fileMatch = cleaned.match(/\/api\/files\/([^/\s]+)/);
    if (fileMatch) {
      const fileId = decodeURIComponent(fileMatch[1]);
      refs.push({ fileId, url: `/api/files/${fileId}` });
      continue;
    }
    const bareId = normalizeArchiveFileId(cleaned);
    if (bareId) {
      refs.push({ fileId: bareId, url: `/api/files/${bareId}` });
      continue;
    }
    const urlMatch = cleaned.match(/(https?:\/\/\S+|data:[^\s]+)/);
    if (urlMatch) refs.push({ url: urlMatch[1] });
  }
  return refs;
}

export function imageRefsFromMessageImages(
  images: Array<{ url?: string; fileId?: string; name?: string }> | undefined,
): PersistedImageRef[] {
  return (images || [])
    .map((img, i) => ({
      fileId: img.fileId ? String(img.fileId) : undefined,
      url: img.url,
      label: img.name || (images!.length > 1 ? `图${i + 1}` : undefined),
    }))
    .filter((r) => Boolean(r.fileId || (r.url && !String(r.url).startsWith('blob:'))));
}

export function mergePersistedImageRefs(
  ...groups: PersistedImageRef[][]
): PersistedImageRef[] {
  const out: PersistedImageRef[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const r of group) {
      const key = r.fileId
        ? `f:${r.fileId}`
        : r.url
          ? `u:${r.url.slice(0, 120)}`
          : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

export function appendImageArchiveBlock(text: string, refs: PersistedImageRef[]): string {
  const block = formatImageArchiveBlock(refs);
  if (!block) return text;
  const base = stripImageArchiveBlock(text).trimEnd();
  return `${base}\n\n${block}`;
}

/** User-visible bubble: hide transcription + archive metadata. */
export function stripUserMessageArtifactsForDisplay(text: string): string {
  return stripImageArchiveBlock(stripPersistedImageTranscription(text));
}

/** User message already contains a persisted vision transcription (multi-turn). */
export function hasPersistedImageTranscription(text: string): boolean {
  return IMAGE_TRANSCRIPTION_MARKER.test(String(text || ''));
}

/**
 * Keep at most one vision-transcription block in a string (first wins).
 * Prevents accidental double-append from racey tool events / rewrites.
 */
export function dedupePersistedImageTranscription(text: string): string {
  const raw = String(text || '');
  const first = raw.search(IMAGE_TRANSCRIPTION_MARKER);
  if (first < 0) return raw;
  const afterFirst = raw.slice(first + 1);
  const secondRel = afterFirst.search(IMAGE_TRANSCRIPTION_MARKER);
  if (secondRel < 0) return raw;
  return raw.slice(0, first + 1 + secondRel).trimEnd();
}

/**
 * Strip persisted vision transcription from user-visible bubble text.
 * The full string (with injection) remains in message.content for the API.
 */
export function stripPersistedImageTranscription(text: string): string {
  const raw = String(text || '');
  const idx = raw.search(IMAGE_TRANSCRIPTION_MARKER);
  if (idx < 0) return raw;
  return raw.slice(0, idx).trimEnd();
}

export function buildPersistedUserMessageContent(
  userText: string,
  injectionDescription: string,
  imageCount: number,
  imageRefs?: PersistedImageRef[],
): string {
  const t = dedupePersistedImageTranscription(String(userText || '').trim());
  if (hasPersistedImageTranscription(t)) {
    return appendImageArchiveBlock(t, imageRefs || parseImageArchiveRefs(t));
  }
  const injection = formatInjectionText(injectionDescription, imageCount);
  let out: string;
  if (!t || t === '(image)') out = injection;
  else if (injectionDescription && t.includes(injectionDescription.trim())) out = t;
  else out = `${t}\n\n${injection}`;
  return appendImageArchiveBlock(out, imageRefs || []);
}

export function injectionBodyFromToolResults(
  results: Array<{ snippet?: string }>,
): { body: string; imageCount: number } {
  const snippets = results.map((r) => String(r.snippet || '').trim()).filter(Boolean);
  if (snippets.length === 0) return { body: '', imageCount: 0 };
  if (snippets.length === 1) return { body: snippets[0], imageCount: 1 };
  const body = snippets.map((s, i) => `【图${i + 1}】\n${s}`).join('\n\n');
  return { body, imageCount: snippets.length };
}
