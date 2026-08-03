/**
 * Shared image size budgets.
 * Upload/ingest hard cap is MAX_INGEST_BYTES (20MB). Vision inlining
 * passthroughs whatever the gateway already stored — no second hard reject.
 * MAX_VISION_INLINE_* is only a soft target when the runtime can downscale.
 */

/** Soft target when createImageBitmap/OffscreenCanvas can recompress. */
export const MAX_VISION_INLINE_BYTES = 1_500_000;

/** Longest edge after optional downscale. */
export const MAX_VISION_EDGE = 1568;

/** Hard reject at ingest/upload (aligned with chat-api FILE_UPLOAD_MAX_BYTES). */
export const MAX_INGEST_BYTES = 20 * 1024 * 1024;
