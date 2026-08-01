import type { IngestedAttachment } from '@/lib/files/ingest';
import type { Message } from '@/lib/chat/types';
import {
  hasPersistedImageTranscription,
  imageRefsFromMessageImages,
  mergePersistedImageRefs,
  parseImageArchiveRefs,
  stripImageArchiveBlock,
  stripUserMessageArtifactsForDisplay,
} from '@/lib/tools/image-understand/persist';

export function sessionHasImages(
  messages: Message[],
  pending: IngestedAttachment[],
): boolean {
  if (pending.some((a) => Boolean(a.dataUrl || a.type.startsWith('image/')))) return true;
  return messages.some((m) => (m.images?.length || 0) > 0);
}

/**
 * Convert UI messages into the shape the chat API expects, including
 * tool_calls / tool receipts and vision vs text image handling.
 */
export function toApiMessages(
  messages: Message[],
  opts?: { vision?: boolean },
) {
  const vision = Boolean(opts?.vision);
  let lastUserIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') lastUserIdx = i;
  }

  return messages.flatMap((m, i) => {
    let content = m.content;
    let images =
      m.images?.map((img) => ({
        url: img.url,
        fileId: img.fileId,
        prompt: img.prompt,
        name: img.name,
      })) || [];

    if (m.role === 'user') {
      const transcribed = hasPersistedImageTranscription(content || '');
      if (vision) {
        const archived = mergePersistedImageRefs(
          imageRefsFromMessageImages(m.images),
          parseImageArchiveRefs(content || ''),
        );
        if (archived.length > 0) {
          images = archived.map((r) => ({
            fileId: r.fileId,
            url: r.fileId
              ? `/api/files/${encodeURIComponent(r.fileId)}`
              : r.url || '',
            name: r.label,
            prompt: undefined,
          }));
        }
        if (transcribed) {
          // Prefer pixels; drop injection + archive metadata from the prompt.
          content = stripUserMessageArtifactsForDisplay(content || '');
          if (!content.trim() && images.length > 0) content = '(image)';
        }
      } else if (transcribed) {
        // Text path: keep transcription, omit pixels + archive block (archive is
        // only for local recovery / later vision switches).
        images = [];
        content = stripImageArchiveBlock(content || '');
      } else if (i !== lastUserIdx) {
        // Older untranscribed uploads: keep lightweight refs only (no data:
        // pixels). The server renders them as 【历史图片引用（未转写）】 markers so
        // the model can transcribe a specific one on demand.
        images = images
          .filter((img) => img.fileId || !String(img.url || '').startsWith('data:'))
          .map((img) => ({
            ...img,
            url: img.fileId
              ? `/api/files/${encodeURIComponent(img.fileId)}`
              : img.url,
          }));
      }
    }

    // Rebuild tool_calls + tool receipts so follow-up turns can see what really ran.
    // claim_reviewer is UI-only and must not be replayed as an API tool.
    // Post-review delta fixes stay out of the bubble body but join history as a note.
    const fix = String(m.reviewFix || '').trim();
    if (fix && m.role === 'assistant') {
      content = `${String(content || '').trim()}\n\n[Correction]\n${fix}`.trim();
    }

    if (m.role === 'assistant') {
      const runs = (m.toolRuns || []).filter(
        (r) => r?.name && r.name !== 'claim_reviewer' && r.status === 'done',
      );
      if (runs.length) {
        const out: Array<Record<string, unknown>> = [];
        const tool_calls = runs.map((r, idx) => ({
          id: String(r.id || `hist_${m.id}_${idx}`),
          type: 'function',
          function: {
            name: r.name,
            arguments: JSON.stringify(r.query ? { query: r.query } : {}),
          },
        }));
        out.push({
          role: 'assistant',
          content: '',
          tool_calls,
          timestamp: m.timestamp,
        });
        for (let idx = 0; idx < runs.length; idx++) {
          const r = runs[idx];
          const payload = r.error
            ? { ok: false, error: r.error, ...(r.query ? { query: r.query } : {}) }
            : {
                ok: true,
                ...(r.query ? { query: r.query } : {}),
                ...(r.provider ? { provider: r.provider } : {}),
                ...(r.results?.length
                  ? {
                      results: r.results.slice(0, 8).map((x) => ({
                        title: x.title,
                        url: x.url,
                        snippet: String(x.snippet || '').slice(0, 240),
                        ...(x.body
                          ? { content: String(x.body).slice(0, 16_000) }
                          : {}),
                      })),
                    }
                  : {}),
              };
          out.push({
            role: 'tool',
            tool_call_id: tool_calls[idx].id,
            content: JSON.stringify(payload),
            timestamp: m.timestamp,
          });
        }
        if (String(content || '').trim()) {
          out.push({
            role: 'assistant',
            content,
            images: [],
            timestamp: m.timestamp,
          });
        }
        return out;
      }
    }

    return [
      {
        role: m.role,
        content,
        images,
        timestamp: m.timestamp as number | undefined,
      },
    ];
  });
}

export function messageImagesToIngested(
  images: Message['images'],
): IngestedAttachment[] {
  return (images || []).map((img) => {
    const url = img.url;
    const isData = url.startsWith('data:');
    const apiPreview = img.fileId
      ? `/api/files/${encodeURIComponent(img.fileId)}`
      : url;
    return {
      id: crypto.randomUUID(),
      name: img.name || 'image.png',
      type: 'image/png',
      size: 0,
      dataUrl: isData ? url : undefined,
      previewUrl: isData ? url : apiPreview,
      fileId: img.fileId,
    };
  });
}

export function ingestedToMessageImages(
  items: IngestedAttachment[],
): NonNullable<Message['images']> {
  return items
    .filter((a) => a.dataUrl || a.fileId || a.previewUrl)
    .map((a) => ({
      url: a.fileId
        ? `/api/files/${encodeURIComponent(a.fileId)}`
        : a.dataUrl || a.previewUrl!,
      name: a.name,
      fileId: a.fileId,
    }));
}
