/**
 * Strip tags from EPUB XHTML/HTML spine documents (best-effort plain text).
 * Keep this “bytes -> plain text” function browser-safe; no server-only deps.
 */
export async function extractEpubTextFromBytes(data: Uint8Array): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const parts: string[] = [];
  const names = Object.keys(zip.files)
    .filter((n) => /\.(x?html?|xml)$/i.test(n) && !/META-INF/i.test(n))
    .sort();
  const limit = Math.min(names.length, 80);
  for (let i = 0; i < limit; i++) {
    const raw = await zip.files[names[i]]!.async('string');
    const text = String(raw || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 40) parts.push(text);
  }
  if (names.length > limit) {
    parts.push(`[…truncated: showing first ${limit} of ${names.length} EPUB documents]`);
  }
  return parts.join('\n\n').trim();
}

