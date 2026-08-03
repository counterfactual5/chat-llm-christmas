/**
 * Cap image payloads before inlining for vision / multimodal LLM calls.
 * Upload can keep originals; only the Edge→LLM hop is downscaled.
 */

/** Soft ceiling for a single vision data-URL (decoded bytes). */
export const MAX_VISION_INLINE_BYTES = 1_500_000;

/** Longest edge after downscale. */
export const MAX_VISION_EDGE = 1568;

function bytesToBase64(buf: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buf).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl.length;
  const b64 = dataUrl.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
}

async function canvasToJpegBlob(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height, 1));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

function visionInlineTooLargeError(byteLength: number, reason: string): Error {
  return new Error(
    `Image is ${byteLength} bytes (vision inline limit ${MAX_VISION_INLINE_BYTES}): ${reason}`,
  );
}

/**
 * If decoded image bytes exceed the vision budget, downscale + JPEG recompress.
 * Throws when the runtime cannot compress (typical on Edge) or the result still exceeds budget —
 * never pass oversized originals through to the LLM.
 */
export async function fitImageBytesForVision(
  buf: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (buf.byteLength <= MAX_VISION_INLINE_BYTES) {
    return { bytes: buf, mime };
  }
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw visionInlineTooLargeError(
      buf.byteLength,
      'runtime cannot downscale images (missing createImageBitmap/OffscreenCanvas). Upload a smaller image.',
    );
  }

  const blob = new Blob([buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer], {
    type: mime || 'image/jpeg',
  });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw visionInlineTooLargeError(buf.byteLength, 'image decode failed before downscale');
  }

  try {
    const qualities = [0.82, 0.7, 0.58, 0.45];
    const edges = [MAX_VISION_EDGE, 1280, 1024, 768];
    let best: Uint8Array | null = null;

    for (const edge of edges) {
      for (const q of qualities) {
        const out = await canvasToJpegBlob(bitmap, edge, q);
        if (!out) continue;
        const bytes = new Uint8Array(await out.arrayBuffer());
        best = bytes;
        if (bytes.byteLength <= MAX_VISION_INLINE_BYTES) {
          return { bytes, mime: 'image/jpeg' };
        }
      }
    }
    throw visionInlineTooLargeError(
      best?.byteLength ?? buf.byteLength,
      'could not compress image under the vision inline budget',
    );
  } finally {
    bitmap.close();
  }
}

/** Shrink an already-built data URL when over budget. */
export async function fitDataUrlForVision(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:') || dataUrlByteLength(dataUrl) <= MAX_VISION_INLINE_BYTES) {
    return dataUrl;
  }
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return dataUrl;
  const mime = match[1] || 'image/jpeg';
  const b64 = match[2] || '';
  let raw: Uint8Array;
  try {
    if (typeof Buffer !== 'undefined') {
      raw = new Uint8Array(Buffer.from(b64, 'base64'));
    } else {
      const bin = atob(b64);
      raw = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    }
  } catch {
    return dataUrl;
  }
  const fitted = await fitImageBytesForVision(raw, mime);
  return `data:${fitted.mime};base64,${bytesToBase64(fitted.bytes)}`;
}
