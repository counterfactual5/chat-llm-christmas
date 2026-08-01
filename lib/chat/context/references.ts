import type {
  ExternalReferenceSourceKind,
  Message,
  WebSearchSource,
} from '@/lib/chat/types';

export function referenceSourceKind(
  provider: string | undefined,
  toolName: string | undefined,
): ExternalReferenceSourceKind {
  const name = String(toolName || '').toLowerCase();
  if (name.startsWith('gmail_') || name.startsWith('gmail-')) return 'gmail';
  if (name.startsWith('calendar_') || name.startsWith('calendar-')) return 'calendar';
  if (name.startsWith('drive_') || name.startsWith('drive-')) return 'drive';
  if (provider === 'notion') return 'notion';
  if (provider === 'github') return 'github';
  if (provider === 'google') return 'google';
  return 'web';
}

export function formatWebSourcesForReference(sources: WebSearchSource[]): string {
  if (!sources.length) return '';
  const byQuery = new Map<string, WebSearchSource[]>();
  for (const s of sources) {
    const key = s.query?.trim() || 'web';
    const list = byQuery.get(key) || [];
    list.push(s);
    byQuery.set(key, list);
  }
  const blocks: string[] = [];
  let n = 1;
  for (const [query, list] of byQuery) {
    const provider = list[0]?.provider;
    const header =
      provider === 'upload'
        ? 'Uploaded files and images in this chat:'
        : provider === 'notion'
          ? query && query !== 'web'
            ? `Notion results for "${query}":`
            : 'Notion pages:'
          : provider === 'google'
            ? query && query !== 'web'
              ? `Google results for "${query}":`
              : 'Google results:'
            : provider === 'github'
              ? query && query !== 'web'
                ? `GitHub results for "${query}":`
                : 'GitHub results:'
              : query === 'web'
                ? 'Web search results:'
                : `Web search results for "${query}"${provider && provider !== 'none' ? ` (${provider})` : ''}:`;
    blocks.push(
      [
        header,
        ...list.map((s) => {
          const title = s.title || s.url || 'Upload';
          const snip = s.snippet?.trim() ? `\n   ${s.snippet.trim()}` : '';
          // Uploaded images are already sent as multimodal parts (or processed by
          // Image Understand). Never duplicate data:/blob:/file URLs as prompt text.
          if (s.provider === 'upload') return `${n++}. ${title}${snip}`;
          return `${n++}. [${title}](${s.url})${snip}`;
        }),
      ].join('\n'),
    );
  }
  return blocks.join('\n\n');
}

/** Rebuild Material sources from every completed search in the chat (deduped by URL). */
export function collectWebSourcesFromMessages(messages: Message[]): WebSearchSource[] {
  const seen = new Set<string>();
  const out: WebSearchSource[] = [];
  for (const m of messages) {
    for (const run of m.toolRuns || []) {
      if (run.status !== 'done' || !run.results?.length) continue;
      // Image understand injects plain text into the prompt — never a Material source.
      if (
        run.name === 'image_understand' ||
        run.provider === 'zhipu-vision' ||
        run.provider === 'image-understand' ||
        run.provider === 'glm-ocr' ||
        run.provider === 'nemotron-omni'
      ) {
        continue;
      }
      for (const r of run.results) {
        if (!r.url || seen.has(r.url)) continue;
        // Skip data: / relative / empty — those are not browseable sources.
        if (/^(data:|blob:|\/)/i.test(r.url)) continue;
        seen.add(r.url);
        out.push({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          provider: run.provider,
          query: run.query,
          sourceKind: referenceSourceKind(run.provider, run.name),
        });
      }
    }
  }
  return out.slice(-40);
}

/** User-uploaded images and ingested text files (not model-generated pictures). */
export function collectUserUploadsFromMessages(messages: Message[]): WebSearchSource[] {
  const seen = new Set<string>();
  const out: WebSearchSource[] = [];

  for (const m of messages) {
    if (m.role !== 'user') continue;

    for (const img of m.images || []) {
      const url = img.fileId
        ? `/api/files/${encodeURIComponent(img.fileId)}`
        : String(img.url || '').trim();
      const key = img.fileId || url;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: img.name || 'Image',
        url,
        snippet: '',
        provider: 'upload',
        query: 'upload',
        messageId: m.id,
        kind: 'image',
      });
    }

    const content = String(m.content || '');
    const fileRe =
      /\[Attached File: ([^\]]+)\]\n([\s\S]*?)(?=\n\n---\n\n|\n\n\[Attached File:|$)/g;
    let match: RegExpExecArray | null;
    while ((match = fileRe.exec(content)) !== null) {
      const name = match[1].trim();
      const text = match[2].trim();
      const key = `file:${m.id}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: name,
        url: '',
        snippet: text.slice(0, 400),
        provider: 'upload',
        query: 'upload',
        messageId: m.id,
        kind: 'file',
      });
    }
  }

  return out;
}
