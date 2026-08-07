export type IngestedAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  /** Plain-text body (small text/code files only). Doc/excel/pdf/epub/zip go through server-side extract. */
  text?: string;
  /**
   * True while the browser is waiting for chat-api to finish the authoritative
   * extract; preview panels should render a "解析中…" affordance for the slot.
   * Set on upload success for text-less non-image attachments; cleared when
   * waitForFileExtractSidecar resolves.
   */
  pendingExtract?: boolean;
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
  /** Last upload failure message (shown in tooltip / debugging). */
  uploadErrorMessage?: string;
  /**
   * Set by the hook when the user is logged out and this attachment has no
   * inline text (docs + images): it will not be uploaded, so the model would
   * silently drop it at send time. UI should warn; the send gate blocks with
   * `needs_login` unless the user signs in.
   */
  attachmentRequiresLogin?: boolean;
};
