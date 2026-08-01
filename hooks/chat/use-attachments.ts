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
        uploading: Boolean(a.dataUrl && isAccountBound),
      }));

      if (placeholders.length > 0) {
        append(placeholders);
      }

      for (const a of next) {
        if (!a.dataUrl || !isAccountBound) continue;

        try {
          const res = await fetch('/api/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl: a.dataUrl, filename: a.name }),
          });
          const data = await res.json();
          if (res.ok && data?.id) {
            const fileId = String(data.id);
            patch(a.id, (x) => ({
              ...x,
              uploading: false,
              uploadError: false,
              fileId,
              previewUrl: `/api/files/${encodeURIComponent(fileId)}`,
            }));
            continue;
          }
          if (isAccountBound) {
            patch(a.id, (x) => ({ ...x, uploading: false, uploadError: !x.dataUrl }));
            continue;
          }
        } catch {
          if (isAccountBound) {
            patch(a.id, (x) => ({ ...x, uploading: false, uploadError: !x.dataUrl }));
            continue;
          }
        }

        patch(a.id, (x) => ({ ...x, uploading: false }));
      }
      if (errors.length > 0) setAttachError(errors.join(' · '));
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
