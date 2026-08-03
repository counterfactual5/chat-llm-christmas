'use client';

/**
 * Composer + edit-message file attachments (ingest, upload, remove).
 */

import { useCallback, useState } from 'react';
import { ingestFiles, type IngestedAttachment } from '@/lib/files/ingest';
import { uploadAttachmentDirect } from '@/lib/files/direct-upload';

export function useChatAttachments(opts: { isAccountBound: boolean }) {
  const { isAccountBound } = opts;
  const [attachments, setAttachments] = useState<IngestedAttachment[]>([]);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
  const [editingMessageAttachments, setEditingMessageAttachments] = useState<
    IngestedAttachment[]
  >([]);
  const [attachError, setAttachError] = useState('');

  const applyIngestedFiles = useCallback(
    async (
      files: FileList | File[],
      append: (placeholders: IngestedAttachment[]) => void,
      patch: (id: string, updater: (x: IngestedAttachment) => IngestedAttachment) => void,
    ) => {
      setAttachError('');
      const { attachments: next, errors } = await ingestFiles(files);

      const placeholders: IngestedAttachment[] = next.map((a) => ({
        ...a,
        uploading: Boolean((a.uploadBlob || a.dataUrl) && isAccountBound),
      }));

      if (placeholders.length > 0) {
        append(placeholders);
      }

      const uploadErrors: string[] = [];
      for (const a of next) {
        if ((!a.uploadBlob && !a.dataUrl) || !isAccountBound) continue;

        try {
          // Prefer browser → chat-api direct upload (upload ticket); falls back
          // to same-origin /api/files if the ticket endpoint is not yet live.
          const uploaded = await uploadAttachmentDirect({
            blob: a.uploadBlob || null,
            dataUrl: a.dataUrl,
            filename: a.name,
            mime: a.type,
            extractText: a.text || null,
          });
          const fileId = String(uploaded.id);
          const isImage = a.type.startsWith('image/') || Boolean(a.dataUrl?.startsWith('data:image'));
          patch(a.id, (x) => ({
            ...x,
            uploading: false,
            uploadError: false,
            fileId,
            // Image thumbs may use /api/files/<id>; docs keep extracted text only.
            previewUrl: isImage
              ? `/api/files/${encodeURIComponent(fileId)}`
              : x.previewUrl,
            uploadBlob: undefined,
          }));
        } catch (err: any) {
          const msg = String(err?.message || 'upload failed');
          const payloadTooLarge =
            /too large|FUNCTION_PAYLOAD_TOO_LARGE|payload too large|FILE_TOO_LARGE|413/i.test(
              msg,
            );
          const isImage =
            a.type.startsWith('image/') || Boolean(a.dataUrl?.startsWith('data:image'));
          uploadErrors.push(
            `${a.name}: ${
              payloadTooLarge ? 'File too large for upload (max 20MB)' : msg
            }`,
          );
          // Images: hard fail (can't chat vision without bytes).
          // Docs/PDFs: soft warn — extracted text still usable for chat.
          patch(a.id, (x) =>
            isImage
              ? { ...x, uploading: false, uploadError: true }
              : { ...x, uploading: false, uploadError: false, uploadBlob: undefined },
          );
        }
      }
      const allErrors = [...errors, ...uploadErrors];
      if (allErrors.length > 0) setAttachError(allErrors.join(' · '));
    },
    [isAccountBound],
  );

  const addIngestedFiles = useCallback(
    async (files: FileList | File[]) => {
      await applyIngestedFiles(
        files,
        (placeholders) => {
          setAttachments((prev) => [...prev, ...placeholders]);
          setAttachmentsExpanded(true);
        },
        (id, updater) => setAttachments((prev) => prev.map((x) => (x.id === id ? updater(x) : x))),
      );
    },
    [applyIngestedFiles],
  );

  const addEditIngestedFiles = useCallback(
    async (files: FileList | File[]) => {
      await applyIngestedFiles(
        files,
        (placeholders) => setEditingMessageAttachments((prev) => [...prev, ...placeholders]),
        (id, updater) =>
          setEditingMessageAttachments((prev) =>
            prev.map((x) => (x.id === id ? updater(x) : x)),
          ),
      );
    },
    [applyIngestedFiles],
  );

  const deleteUploadedFile = useCallback((fileId?: string) => {
    if (!fileId) return;
    void fetch(`/api/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }).catch(
      (error) => console.warn('[files] delete removed attachment failed:', error),
    );
  }, []);

  const removeEditingMessageAttachment = useCallback((id: string) => {
    setEditingMessageAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      // Do not delete the remote file here: the user may cancel the edit and
      // the original saved message would still reference it.
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const removeAttachment = useCallback(
    (id: string) => {
      const toRemove = attachments.find((a) => a.id === id);
      if (toRemove?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(toRemove.previewUrl);
      deleteUploadedFile(toRemove?.fileId);
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    },
    [attachments, deleteUploadedFile],
  );

  return {
    attachments,
    setAttachments,
    attachmentsExpanded,
    setAttachmentsExpanded,
    editingMessageAttachments,
    setEditingMessageAttachments,
    attachError,
    setAttachError,
    applyIngestedFiles,
    addIngestedFiles,
    addEditIngestedFiles,
    removeAttachment,
    removeEditingMessageAttachment,
  };
}
