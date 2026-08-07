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
   * Reserved for Phase 5 — not currently set by ingest.
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
};
