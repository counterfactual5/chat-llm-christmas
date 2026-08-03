/**
 * Prepare image bytes for vision / multimodal LLM inlining.
 * Prefer a smaller JPEG when the runtime can downscale; otherwise passthrough
 * the gateway bytes as-is (upload already enforced MAX_INGEST_BYTES).
 */

import { MAX_VISION_EDGE, MAX_VISION_INLINE_BYTES } from '@/lib/files/image-budget';

export { MAX_VISION_EDGE, MAX_VISION_INLINE_BYTES } from '@/lib/files/image-budget';

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

function canDownscaleImages(): boolean {
  return (
    typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined'
  );
}

/**
 * Optionally downscale large images when canvas APIs exist.
 * Never rejects on size — gateway fetch already passed ingest limits.
 */
export async function fitImageBytesForVision(
  buf: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (buf.byteLength <= MAX_VISION_INLINE_BYTES || !canDownscaleImages()) {
    return { bytes: buf, mime };
  }

  const blob = new Blob(
    [buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer],
    { type: mime || 'image/jpeg' },
  );
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return { bytes: buf, mime };
  }

  try {
    const qualities = [0.82, 0.7, 0.58, 0.45];
    const edges = [MAX_VISION_EDGE, 1280, 1024, 768];

    for (const edge of edges) {
      for (const q of qualities) {
        const out = await canvasToJpegBlob(bitmap, edge, q);
        if (!out) continue;
        const bytes = new Uint8Array(await out.arrayBuffer());
        if (bytes.byteLength <= MAX_VISION_INLINE_BYTES) {
          return { bytes, mime: 'image/jpeg' };
        }
      }
    }
    // Could not shrink under soft target — still send original pixels.
    return { bytes: buf, mime };
  } finally {
    bitmap.close();
  }
}

/** Shrink an already-built data URL when over soft budget; else passthrough. */
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
      raw = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
    }
  } catch {
    return dataUrl;
  }
  const fitted = await fitImageBytesForVision(raw, mime);
  return `data:${fitted.mime};base64,${bytesToBase64(fitted.bytes)}`;
}
