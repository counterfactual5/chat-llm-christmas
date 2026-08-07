/** Pure helper for use-attachments: decide the post-upload-failure patch.
 *
 *  Three shapes:
 *   - image → always hard-fail (vision needs bytes; no text fallback).
 *   - text-bearing non-image (plain-text ingest) → soft-fail; extracted text
 *     is still usable for chat even without a stored binary.
 *   - text-less non-image → hard-fail; there is nothing to send.
 */
import type { IngestedAttachment } from '@/lib/files/ingest';

export function uploadFailurePatch(opts: {
  isImage: boolean;
  text?: string;
  msg: string;
}): Pick<IngestedAttachment, 'uploading' | 'uploadError' | 'uploadErrorMessage' | 'uploadBlob'> {
  const { isImage, text, msg } = opts;
  if (isImage) {
    return {
      uploading: false,
      uploadError: true,
      uploadErrorMessage: msg,
    };
  }
  if (String(text || '').trim()) {
    return { uploading: false, uploadError: false, uploadBlob: undefined };
  }
  return {
    uploading: false,
    uploadError: true,
    uploadErrorMessage: msg,
  };
}

/** True when the attachment is an image (vision path; uploads hard-fail). */
export function isImageType(a: Pick<IngestedAttachment, 'type' | 'dataUrl'>): boolean {
  return Boolean(
    a.type?.startsWith('image/') || a.dataUrl?.startsWith('data:image'),
  );
}
