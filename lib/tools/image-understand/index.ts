/**
 * Image-understand public API (barrel).
 *
 * Module map:
 * - `./artifacts` — client-safe archive/transcription helpers (no vision API)
 * - `./vision` — VLM/OCR pipeline (understandImages, resolveImageUrlForVision, …)
 * - `./rewrite` — rewriteMessagesWithImageDescriptions (uses artifacts + vision)
 * - `./persist` — deprecated re-export of this barrel (compat)
 */

export {
  type PersistedImageRef,
  formatInjectionText,
  formatImageArchiveBlock,
  stripImageArchiveBlock,
  parseImageArchiveRefs,
  imageRefsFromMessageImages,
  mergePersistedImageRefs,
  appendImageArchiveBlock,
  stripUserMessageArtifactsForDisplay,
  hasPersistedImageTranscription,
  dedupePersistedImageTranscription,
  stripPersistedImageTranscription,
  buildPersistedUserMessageContent,
  injectionBodyFromToolResults,
} from './artifacts';

export {
  IMAGE_UNDERSTAND_MODEL,
  IMAGE_UNDERSTAND_FALLBACK_MODEL,
  IMAGE_OCR_MODEL,
  type ImageUnderstandInput,
  type ImageUnderstandResult,
  resolveImageUrlForVision,
  buildImageUnderstandSystemPrompt,
  splitBatchImageTexts,
  understandImages,
  understandImage,
} from './vision';

export { rewriteMessagesWithImageDescriptions } from './rewrite';
