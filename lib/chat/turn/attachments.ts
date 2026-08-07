/**
 * Pending attachment selection, upload/vision gates, and user-turn content assembly.
 * Pure — the chat hook still owns UI error strings and session updates.
 *
 * Attachment-text contract (post server-authority): browser ingest only inlines
 * `text` for small plain-text/code files. Doc formats (pdf/docx/epub/pptx/xlsx/
 * zip) arrive with a `fileId` but no `text` after U4a — the authoritative extract
 * lives server-side in the chat-api extract sidecar and is pulled on demand via
 * `file_read`. `assembleUserContent` therefore emits two block shapes sharing the
 * same `[Attached File: name] (stored fileId:…)` header:
 *   - text-bearing  → body is the inline extract (unchanged behavior)
 *   - fileId-only   → body is a pointer telling the model to file_read the fileId
 * Both parse identically downstream (parseAttachedFileBlocks / history collapse /
 * scrub-deleted-file all key off the header + fileId, never the body shape).
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
  /** Non-image attachments with an inline `text` body (plain-text/code files). */
  pendingTexts: IngestedAttachment[];
  /** Non-image attachments with a `fileId` but no `text` (server-extract docs). */
  pendingDocRefs: IngestedAttachment[];
  uploadChecks: IngestedAttachment[];
  fullContent: string;
};

export type ResolvePendingAttachmentsResult =
  | ResolvedPendingAttachments
  | { ok: false; error: AttachmentGateError };

/** True while any composer/edit attachment is still uploading to storage. */
export function hasUploadingAttachments(
  attachments: Pick<IngestedAttachment, 'uploading'>[],
): boolean {
  return attachments.some((a) => a.uploading);
}

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
      ? attachments.filter(
          (a) => isImageAttachment(a) && (a.dataUrl || a.fileId),
        )
      : [];
  const pendingTexts = resendAttachments
    ? resendAttachments.filter((a) => Boolean(a.text) && !isImageAttachment(a))
    : baseMessagesOverride
      ? []
      : isActiveSession
        ? attachments.filter((a) => Boolean(a.text) && !isImageAttachment(a))
        : [];
  // fileId-only docs (pdf/docx/epub/xlsx/zip post-U4a): the browser never sees
  // the extract, but the attachment still has content the model can reach via
  // file_read — so it must ride along as a pointer, not get silently dropped.
  const pendingDocRefs = resendAttachments
    ? resendAttachments.filter(
        (a) => !a.text && Boolean(a.fileId) && !isImageAttachment(a),
      )
    : baseMessagesOverride
      ? []
      : isActiveSession
        ? attachments.filter(
            (a) => !a.text && Boolean(a.fileId) && !isImageAttachment(a),
          )
        : [];

  if (
    (!textToSend.trim() &&
      pendingImages.length === 0 &&
      pendingTexts.length === 0 &&
      pendingDocRefs.length === 0) ||
    (!force && isLoading && !alreadyLoading)
  ) {
    return { ok: false, error: 'empty' };
  }
  if (pendingImages.length > 0 && !vision && !zhipuVisionOn) {
    return { ok: false, error: 'images_need_vision' };
  }
  const uploadChecks = resendAttachments ?? (isActiveSession ? attachments : []);
  if (hasUploadingAttachments(uploadChecks)) {
    return { ok: false, error: 'upload_in_progress' };
  }
  // Hard-block on upload failure when the attachment has no inline fallback:
  // images (vision needs the stored file) and text-less docs (post-U4a the
  // extract lives server-side; with no fileId there's nothing to file_read).
  // Empty-string text is treated the same as missing (post-trim).
  // Only text-bearing plain-text files may still send when their upload fails.
  if (
    uploadChecks.some(
      (a) => a.uploadError && (isImageAttachment(a) || !String(a.text || '').trim()),
    )
  ) {
    return { ok: false, error: 'upload_failed' };
  }

  return {
    ok: true,
    pendingImages,
    pendingTexts,
    pendingDocRefs,
    uploadChecks,
    fullContent: assembleUserContent(textToSend, pendingTexts, pendingDocRefs),
  };
}

/**
 * Body emitted for a fileId-only attachment: no inline extract (the browser
 * does not have it), so point the model at the server-side sidecar instead.
 */
function docRefBody(fileId: string): string {
  return (
    `(content is stored server-side in the extract sidecar; ` +
    `to inspect it, call file_read with file_id=${fileId})`
  );
}

/**
 * Embed file attachments ahead of the user ask. Plain-text files inline their
 * extracted body; fileId-only docs emit a file_read pointer (same header shape,
 * so history collapse / sidecar re-read downstream is unchanged).
 */
export function assembleUserContent(
  textToSend: string,
  pendingTexts: IngestedAttachment[],
  pendingDocRefs: IngestedAttachment[] = [],
): string {
  let fullContent = textToSend.trim();
  if (pendingTexts.length > 0 || pendingDocRefs.length > 0) {
    const contextParts = [
      ...pendingTexts.map((a) => {
        const stored = a.fileId
          ? ` (stored fileId: ${a.fileId})`
          : '';
        return `[Attached File: ${a.name}]${stored}\n${a.text!.trim()}`;
      }),
      ...pendingDocRefs.map((a) => {
        const fileId = a.fileId!;
        return `[Attached File: ${a.name}] (stored fileId: ${fileId})\n${docRefBody(fileId)}`;
      }),
    ];
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
