/**
 * Client-side image downscale/compress before upload.
 * Direct uploads can be large; Edge vision inlining cannot reliably recompress,
 * so we shrink in the browser (canvas) to the shared vision budget.
 */

import {
  MAX_INGEST_BYTES,
  MAX_VISION_EDGE,
  MAX_VISION_INLINE_BYTES,
} from '@/lib/files/image-budget';

export { MAX_INGEST_BYTES, MAX_VISION_INLINE_BYTES as MAX_UPLOAD_BYTES };

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * Downscale + recompress large images for vision inlining + storage.
 * Returns the original file when already small enough / non-browser env.
 */
export async function prepareImageForUpload(file: File): Promise<{
  blob: Blob;
  dataUrl: string;
  mime: string;
  filename: string;
  size: number;
}> {
  const originalDataUrl = await readAsDataUrl(file);
  if (typeof document === 'undefined' || file.size <= MAX_VISION_INLINE_BYTES) {
    return {
      blob: file,
      dataUrl: originalDataUrl,
      mime: file.type || 'application/octet-stream',
      filename: file.name || 'upload.bin',
      size: file.size,
    };
  }

  try {
    const img = await loadImage(originalDataUrl);
    const scale = Math.min(1, MAX_VISION_EDGE / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        blob: file,
        dataUrl: originalDataUrl,
        mime: file.type || 'application/octet-stream',
        filename: file.name || 'upload.bin',
        size: file.size,
      };
    }
    ctx.drawImage(img, 0, 0, width, height);

    // Prefer JPEG for screenshots/photos — much smaller than PNG for the same pixels.
    const mime = 'image/jpeg';
    const qualities = [0.85, 0.72, 0.6, 0.48, 0.36];
    const edges = [width, Math.min(width, 1280), Math.min(width, 1024), Math.min(width, 768)];

    let best: Blob | null = null;
    for (const edge of edges) {
      const edgeScale = edge / width;
      const w = Math.max(1, Math.round(width * edgeScale));
      const h = Math.max(1, Math.round(height * edgeScale));
      if (w !== canvas.width || h !== canvas.height) {
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
      }
      for (const q of qualities) {
        const blob = await canvasToBlob(canvas, mime, q);
        if (!blob) continue;
        best = blob;
        if (blob.size <= MAX_VISION_INLINE_BYTES) {
          const base = (file.name || 'image').replace(/\.[^.]+$/, '');
          const filename = `${base}.jpg`;
          const dataUrl = await readAsDataUrl(blob);
          return { blob, dataUrl, mime, filename, size: blob.size };
        }
      }
    }

    if (!best) {
      return {
        blob: file,
        dataUrl: originalDataUrl,
        mime: file.type || 'application/octet-stream',
        filename: file.name || 'upload.bin',
        size: file.size,
      };
    }

    throw new Error(
      `${file.name} is still too large after compression (${(best.size / (1024 * 1024)).toFixed(1)}MB). Try a smaller image.`,
    );
  } catch (err) {
    if (err instanceof Error && /too large after compression/i.test(err.message)) throw err;
    // Fall back to original; Edge may still passthrough under the hard cap.
    return {
      blob: file,
      dataUrl: originalDataUrl,
      mime: file.type || 'application/octet-stream',
      filename: file.name || 'upload.bin',
      size: file.size,
    };
  }
}
