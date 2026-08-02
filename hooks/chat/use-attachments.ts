'use client';

/**
 * Composer + edit-message file attachments (ingest, upload, remove).
 */

import { useCallback, useState } from 'react';
import { ingestFiles, type IngestedAttachment } from '@/lib/files/ingest';

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
          let res: Response;
          if (a.uploadBlob) {
            // Multipart avoids base64 inflation that trips Vercel's ~4.5MB body limit.
            const form = new FormData();
            form.append('file', a.uploadBlob, a.name);
            res = await fetch('/api/files', { method: 'POST', body: form });
          } else {
            res = await fetch('/api/files', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dataUrl: a.dataUrl, filename: a.name }),
            });
          }
          const rawText = await res.text();
          let data: any = {};
          try {
            data = rawText ? JSON.parse(rawText) : {};
          } catch {
            data = { error: rawText.slice(0, 200) };
          }
          if (res.ok && data?.id) {
            const fileId = String(data.id);
            patch(a.id, (x) => ({
              ...x,
              uploading: false,
              uploadError: false,
              fileId,
              previewUrl: `/api/files/${encodeURIComponent(fileId)}`,
              uploadBlob: undefined,
            }));
            continue;
          }
          const payloadTooLarge =
            res.status === 413 ||
            /FUNCTION_PAYLOAD_TOO_LARGE|payload too large|request entity too large/i.test(
              `${data?.error || ''} ${rawText}`,
            );
          const detail = payloadTooLarge
            ? 'Image too large for upload (max ~1.5MB after compress)'
            : typeof data?.error === 'string'
              ? data.error
              : `Upload failed (HTTP ${res.status})`;
          uploadErrors.push(`${a.name}: ${detail}`);
          patch(a.id, (x) => ({ ...x, uploading: false, uploadError: true }));
          continue;
        } catch (err: any) {
          uploadErrors.push(`${a.name}: ${err?.message || 'upload failed'}`);
          patch(a.id, (x) => ({ ...x, uploading: false, uploadError: true }));
          continue;
        }

        patch(a.id, (x) => ({ ...x, uploading: false }));
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
