/**
 * Pending attachment selection, upload/vision gates, and user-turn content assembly.
 * Pure — the chat hook still owns UI error strings and session updates.
 */

import { isImageAttachment } from '@/components/files/AttachmentImageThumb';
import type { Message } from '@/lib/chat/types';
import type { IngestedAttachment } from '@/lib/files/ingest';

export type AttachmentGateError =
  | 'images_need_vision'
  | 'upload_in_progress'
  | 'upload_failed'
  | 'empty';

export type ResolvePendingAttachmentsOpts = {
  textToSend: string;
  attachments: IngestedAttachment[];
  resendAttachments?: IngestedAttachment[];
  /** When editing/resending with priorMessages, skip composer text-file inject. */
  baseMessagesOverride?: Message[] | null;
  isActiveSession: boolean;
  vision: boolean;
  zhipuVisionOn: boolean;
  isLoading: boolean;
  force?: boolean;
  alreadyLoading?: boolean;
};

export type ResolvedPendingAttachments = {
  ok: true;
  pendingImages: IngestedAttachment[];
  pendingTexts: IngestedAttachment[];
  uploadChecks: IngestedAttachment[];
  fullContent: string;
};

export type ResolvePendingAttachmentsResult =
  | ResolvedPendingAttachments
  | { ok: false; error: AttachmentGateError };

export function resolvePendingAttachments(
  opts: ResolvePendingAttachmentsOpts,
): ResolvePendingAttachmentsResult {
  const {
    textToSend,
    attachments,
    resendAttachments,
    baseMessagesOverride,
    isActiveSession,
    vision,
    zhipuVisionOn,
    isLoading,
    force,
    alreadyLoading,
  } = opts;

  const pendingImages = resendAttachments
    ? resendAttachments.filter(
        (a) => isImageAttachment(a) && (a.dataUrl || a.fileId),
      )
    : isActiveSession
      ? attachments.filter((a) => a.dataUrl || a.fileId)
      : [];
  const pendingTexts = resendAttachments
    ? resendAttachments.filter((a) => a.text)
    : baseMessagesOverride
      ? []
      : isActiveSession
        ? attachments.filter((a) => a.text)
        : [];

  if (
    (!textToSend.trim() && pendingImages.length === 0 && pendingTexts.length === 0) ||
    (!force && isLoading && !alreadyLoading)
  ) {
    return { ok: false, error: 'empty' };
  }
  if (pendingImages.length > 0 && !vision && !zhipuVisionOn) {
    return { ok: false, error: 'images_need_vision' };
  }
  const uploadChecks = resendAttachments ?? (isActiveSession ? attachments : []);
  if (uploadChecks.some((a) => a.uploading)) {
    return { ok: false, error: 'upload_in_progress' };
  }
  if (uploadChecks.some((a) => a.uploadError)) {
    return { ok: false, error: 'upload_failed' };
  }

  return {
    ok: true,
    pendingImages,
    pendingTexts,
    uploadChecks,
    fullContent: assembleUserContent(textToSend, pendingTexts),
  };
}

/** Embed text-file attachments ahead of the user ask. */
export function assembleUserContent(
  textToSend: string,
  pendingTexts: IngestedAttachment[],
): string {
  let fullContent = textToSend.trim();
  if (pendingTexts.length > 0) {
    const contextParts = pendingTexts.map(
      (a) => `[Attached File: ${a.name}]\n${a.text!.trim()}`,
    );
    fullContent =
      contextParts.join('\n\n') + (fullContent ? `\n\n---\n\n${fullContent}` : '');
  }
  return fullContent;
}

export function messageImagesFromAttachments(
  pendingImages: IngestedAttachment[],
): NonNullable<Message['images']> {
  return pendingImages.map((a) => ({
    url: a.fileId
      ? `/api/files/${encodeURIComponent(a.fileId)}`
      : a.dataUrl!,
    name: a.name,
    fileId: a.fileId,
  }));
}

/** Drop trailing empty incomplete assistant shell before appending a new user turn. */
export function cleanBaseMessagesForSend(sessionMessages: Message[]): Message[] {
  return sessionMessages.filter(
    (m, idx, arr) =>
      !(idx === arr.length - 1 && m.role === 'assistant' && m.incomplete && !m.content),
  );
}

export function titleForNewConversation(
  textToSend: string,
  pendingImages: IngestedAttachment[] = [],
): string {
  const seed = textToSend || pendingImages[0]?.name || 'New Conversation';
  return seed.slice(0, 30) + (textToSend.length > 30 ? '...' : '');
}
