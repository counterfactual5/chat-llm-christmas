/**
 * `/image` turn planning + `/api/images` call.
 * Pure thread-building + fetch/parse; the chat hook still owns
 * setSessions patches (via stream-error.ts) and UI side effects.
 */

import type { Message } from '@/lib/chat/types';
import { titleForNewConversation } from '@/lib/chat/turn/attachments';

export type ImageGenerationThread = {
  thread: Message[];
  assistantId: string;
  newTitle?: string;
};

export type BuildImageGenerationThreadOpts = {
  prompt: string;
  cleanedBase: Message[];
  /** Retry path: assistant shell replaces the failed one, no new `/image` user turn. */
  skipDuplicateUser?: boolean;
  currentTitle?: string;
  now?: () => number;
  genId?: () => string;
};

/** Build the `/image <prompt>` user turn + placeholder assistant bubble. */
export function buildImageGenerationThread(
  opts: BuildImageGenerationThreadOpts,
): ImageGenerationThread {
  const now = opts.now ?? Date.now;
  const genId = opts.genId ?? (() => crypto.randomUUID());
  const { prompt, cleanedBase, skipDuplicateUser, currentTitle } = opts;

  const assistantId = genId();
  const assistantMessage: Message = {
    id: assistantId,
    role: 'assistant',
    content: 'Generating image…',
    timestamp: now(),
    incomplete: true,
  };

  let newTitle = currentTitle;
  if (cleanedBase.length === 0 || (cleanedBase.length === 1 && skipDuplicateUser)) {
    newTitle = titleForNewConversation(prompt);
  }

  const thread = skipDuplicateUser
    ? [...cleanedBase, assistantMessage]
    : [
        ...cleanedBase,
        {
          id: genId(),
          role: 'user' as const,
          content: `/image ${prompt}`,
          timestamp: now(),
        },
        assistantMessage,
      ];

  return { thread, assistantId, newTitle };
}

export type ImageGenerationRequest = {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
};

export type ImageGenerationResult =
  | { ok: true; image: string; fileId?: string }
  | { ok: false; error: string };

/** Call `/api/images`, tolerating non-JSON/non-2xx bodies. */
export async function requestImageGeneration(
  req: ImageGenerationRequest,
  opts?: { fetchImpl?: typeof fetch },
): Promise<ImageGenerationResult> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const res = await doFetch('/api/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: req.prompt,
      model: req.model ?? 'gpt-image-1.5',
      size: req.size ?? '1024x1024',
      quality: req.quality ?? 'medium',
    }),
  });
  const raw = await res.text();

  let data: { error?: string; image?: string; fileId?: string } = {};
  try {
    data = raw ? (JSON.parse(raw) as typeof data) : {};
  } catch {
    return {
      ok: false,
      error:
        raw.trim().slice(0, 400) || `Image API returned non-JSON (HTTP ${res.status})`,
    };
  }

  if (!res.ok) {
    return { ok: false, error: data?.error || `Image generation failed (HTTP ${res.status})` };
  }
  if (!data?.image) {
    return { ok: false, error: 'No image returned' };
  }
  return { ok: true, image: data.image, fileId: data.fileId ? String(data.fileId) : undefined };
}
