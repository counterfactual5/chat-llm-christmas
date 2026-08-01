import {
  appendImageArchiveBlock,
  dedupePersistedImageTranscription,
  formatInjectionText,
  hasPersistedImageTranscription,
  normalizeArchiveFileId,
} from './artifacts';
import { understandImages } from './vision';

function textPartsFromMessageContent(parts: any[]): string {
  return parts
    .filter((p) => p && p.type === 'text')
    .map((p) => String(p.text || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function collapseContentParts(parts: any[]): any {
  const collapsed: any[] = [];
  for (const p of parts) {
    const last = collapsed[collapsed.length - 1];
    if (p?.type === 'text' && last?.type === 'text') {
      last.text = `${last.text}\n\n${p.text}`;
    } else {
      collapsed.push(p);
    }
  }
  if (collapsed.length === 1 && collapsed[0]?.type === 'text') {
    return collapsed[0].text;
  }
  return collapsed;
}

/** Drop image_url parts; keep text (and any other non-image parts). */
function stripImageUrlParts(msg: any): any {
  if (!Array.isArray(msg?.content)) return msg;
  const kept = msg.content.filter((p: any) => p && p.type !== 'image_url');
  const text = textPartsFromMessageContent(msg.content);
  if (kept.length === 0) {
    return { ...msg, content: text || '(image)' };
  }
  return { ...msg, content: collapseContentParts(kept) };
}

function collectImageSlots(content: any[]): Array<{ partIndex: number; url: string; label: string }> {
  const imageSlots: Array<{ partIndex: number; url: string; label: string }> = [];
  let imageIndex = 0;
  for (let i = 0; i < content.length; i++) {
    const part = content[i];
    if (!part || part.type !== 'image_url') continue;
    const url = String(part?.image_url?.url || part?.url || '').trim();
    if (!url) continue;
    imageIndex += 1;
    imageSlots.push({ partIndex: i, url, label: `Image ${imageIndex}` });
  }
  return imageSlots;
}

/**
 * Replace image_url parts with plain-text descriptions from GLM-4.6V.
 * Every user turn that still has pixels but no persisted transcription is sent
 * to vision once. Older transcribed images are stripped from the request.
 *
 * Returns `didUnderstand` so the chat route can drop the image_understand tool
 * for this request and avoid injecting the same text again via a tool call.
 */
export async function rewriteMessagesWithImageDescriptions(
  messages: any[],
  gateway: { apiKey: string; baseURL: string },
  opts?: {
    send?: (payload: Record<string, unknown>) => void;
    /** Last user text in thread — used only when the latest turn is image-only. */
    userAsk?: string;
  },
): Promise<{ messages: any[]; didUnderstand: boolean }> {
  let lastUserIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') lastUserIdx = i;
  }

  const out: any[] = [];
  let didUnderstand = false;

  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (msg?.role === 'system' || !Array.isArray(msg?.content)) {
      if (typeof msg?.content === 'string') {
        out.push({
          ...msg,
          content: dedupePersistedImageTranscription(msg.content),
        });
      } else {
        out.push(msg);
      }
      continue;
    }

    const ownTurnText = textPartsFromMessageContent(msg.content);
    const turnPrompt =
      ownTurnText ||
      (mi === lastUserIdx ? String(opts?.userAsk || '').trim() : '');

    if (hasPersistedImageTranscription(turnPrompt)) {
      out.push(stripImageUrlParts(msg));
      continue;
    }

    const imageSlots = collectImageSlots(msg.content);
    if (imageSlots.length === 0) {
      out.push(msg);
      continue;
    }

    // Never put image_url on assistant turns. Older user turns: keep text only —
    // re-running 4.6V on every historical upload causes timeouts / “interrupted”.
    if (msg.role !== 'user' || mi !== lastUserIdx) {
      out.push(stripImageUrlParts(msg));
      continue;
    }

    const query = turnPrompt
      ? turnPrompt.slice(0, 120)
      : `${imageSlots.length} image(s)`;

    opts?.send?.({
      tool: {
        status: 'start',
        name: 'image_understand',
        query,
        provider: 'image-understand',
        targetTimestamp:
          typeof msg.timestamp === 'number' ? msg.timestamp : undefined,
      },
    });

    const batch = await understandImages(
      imageSlots.map((s) => s.url),
      turnPrompt,
      gateway,
    );
    didUnderstand = true;

    opts?.send?.({
      tool: {
        status: 'done',
        name: 'image_understand',
        query,
        provider: batch.provider || 'image-understand',
        targetTimestamp:
          typeof msg.timestamp === 'number' ? msg.timestamp : undefined,
        results: batch.ok
          ? imageSlots.map((slot, i) => ({
              title: slot.label,
              url: '',
              snippet: batch.texts[i] || batch.text,
            }))
          : [],
        error: batch.ok ? undefined : batch.text,
      },
    });

    const descByPartIndex = new Map<number, true>();
    imageSlots.forEach((slot) => {
      descByPartIndex.set(slot.partIndex, true);
    });

    const imageTexts = imageSlots.map((_, i) => {
      const body = batch.texts[i] || batch.text;
      return batch.ok
        ? imageSlots.length > 1
          ? `【图${i + 1}】\n${body}`
          : body
        : `[Image understanding failed] ${body}`;
    });
    const joinedBodies = imageTexts.join('\n\n');
    // Text parts already carry this body (e.g. client re-sent persisted text + images):
    // keep text, drop images — do not wrap/inject again.
    if (
      hasPersistedImageTranscription(turnPrompt) ||
      (joinedBodies && turnPrompt.includes(joinedBodies.trim()))
    ) {
      out.push(stripImageUrlParts(msg));
      continue;
    }

    const injection = formatInjectionText(joinedBodies, imageSlots.length);

    const rebuilt: any[] = [];
    let injected = false;
    for (let i = 0; i < msg.content.length; i++) {
      if (descByPartIndex.has(i)) {
        if (!injected) {
          rebuilt.push({ type: 'text', text: injection });
          injected = true;
        }
        continue;
      }
      const part = msg.content[i];
      if (part?.type === 'text' && typeof part.text === 'string') {
        rebuilt.push({
          ...part,
          text: dedupePersistedImageTranscription(part.text),
        });
      } else {
        rebuilt.push(part);
      }
    }

    const collapsed = collapseContentParts(rebuilt);
    const archiveRefs = imageSlots.map((s) => {
      const fileId = normalizeArchiveFileId(s.url);
      return fileId ? { fileId, url: `/api/files/${fileId}` } : { url: s.url };
    });
    const withArchive =
      typeof collapsed === 'string'
        ? appendImageArchiveBlock(collapsed, archiveRefs)
        : collapsed;
    out.push({ ...msg, content: withArchive });
  }

  return { messages: out, didUnderstand };
}
