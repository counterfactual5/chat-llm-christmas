export type IngestedAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  text?: string;
  /** data: URL for images (legacy / offline fallback) */
  dataUrl?: string;
  previewUrl?: string;
  /** Binary ready for multipart upload (preferred over posting dataUrl JSON). */
  uploadBlob?: Blob;
  /** Gateway Files API id after upload — preferred for chat. */
  fileId?: string;
  /** Client-side upload state when account-bound upload is in progress. */
  uploading?: boolean;
  /** Gateway upload failed (network / server); local preview may still exist. */
  uploadError?: boolean;
};
