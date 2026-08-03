/**
 * Shared image size budgets: client upload compress + Edge vision inlining.
 * Keep these in one place so ingest and vision-inline cannot drift apart.
 */

/** Soft ceiling for a single vision data-URL (decoded bytes) before LLM inline. */
export const MAX_VISION_INLINE_BYTES = 1_500_000;

/**
 * When Edge cannot downscale (no OffscreenCanvas), allow passthrough up to this
 * instead of dropping the image and failing the whole turn.
 */
export const MAX_VISION_PASSTHROUGH_BYTES = 4_000_000;

/** Longest edge after downscale (multimodal sweet spot). */
export const MAX_VISION_EDGE = 1568;

/** Hard reject before we even try to read (aligned with chat-api FILE_UPLOAD_MAX_BYTES). */
export const MAX_INGEST_BYTES = 20 * 1024 * 1024;
