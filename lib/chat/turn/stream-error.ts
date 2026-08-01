/**
 * Apply stream / image outcomes onto assistant messages.
 * Hook still calls setSessions; these decide the next Message shape.
 */

import type { Message } from '@/lib/chat/types';

export type StreamFailureKeep = 'content' | 'content_or_reasoning';

export type StreamFailureOpts = {
  keep?: StreamFailureKeep;
  fallbackMessage?: string;
};

function failureMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = String((error as { message?: unknown }).message || '').trim();
    if (msg) return msg;
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}

export function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: string }).name === 'AbortError',
  );
}

/** Rewrite one assistant message after a failed stream. */
export function patchAssistantAfterStreamFailure(
  message: Message,
  error: unknown,
  opts?: StreamFailureOpts,
): Message {
  const fallback = opts?.fallbackMessage || 'Request failed';
  const reason = failureMessage(error, fallback);
  const keep = opts?.keep ?? 'content_or_reasoning';
  const hasPartial =
    keep === 'content_or_reasoning'
      ? Boolean(message.content.trim() || message.reasoning?.trim())
      : Boolean(message.content.trim());

  if (hasPartial) {
    return {
      ...message,
      incomplete: true,
      truncationReason: reason,
    };
  }
  return {
    ...message,
    content: `Error: ${reason}`,
    incomplete: false,
    truncationReason: undefined,
  };
}

/** Map a session message list after stream failure (non-abort). */
export function applyAssistantStreamFailure(
  messages: Message[],
  assistantId: string,
  error: unknown,
  opts?: StreamFailureOpts,
): Message[] {
  return messages.map((m) =>
    m.id === assistantId ? patchAssistantAfterStreamFailure(m, error, opts) : m,
  );
}

/** @deprecated Prefer patchAssistantAfterStreamFailure */
export function applyStreamFailureToAssistant(
  message: Message,
  errorMessage: string,
  keep: StreamFailureKeep = 'content_or_reasoning',
): Message {
  return patchAssistantAfterStreamFailure(message, errorMessage, { keep });
}

export function applyGeneratedImageToAssistant(
  message: Message,
  opts: {
    imageUrl: string;
    prompt: string;
    fileId?: string;
    modelLabel?: string;
  },
): Message {
  return {
    ...message,
    content: '',
    images: [
      {
        url: opts.imageUrl,
        name: 'generated.png',
        prompt: opts.prompt,
        model: opts.modelLabel || 'GPT Image 1.5',
        fileId: opts.fileId,
      },
    ],
    incomplete: false,
  };
}

export function applyImageGenerationError(
  message: Message,
  errorMessage: string,
): Message {
  return {
    ...message,
    content: `Error: ${errorMessage || 'Image generation failed'}`,
    incomplete: false,
    images: undefined,
  };
}

/** Map one assistant id inside a session message list. */
export function mapAssistantById(
  messages: Message[],
  assistantId: string,
  patch: (m: Message) => Message,
): Message[] {
  return messages.map((m) => (m.id === assistantId ? patch(m) : m));
}
