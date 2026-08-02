/** Client-side image downscale/compress before upload (Vercel request body ~4.5MB). */

/** Soft ceiling after compress — small enough for Vercel upload (~4.5MB) and
 *  for Edge→LLM vision inlining (base64 ≈ 4/3 size). */
export const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024;

/** Hard reject before we even try to read (phone RAW / huge PNG). */
export const MAX_INGEST_BYTES = 20 * 1024 * 1024;

/** Longest edge for vision-friendly downscale (common multimodal API sweet spot). */
const MAX_EDGE = 1568;

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
 * Downscale + recompress large images so `/api/files` stays under Vercel's body limit.
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
  if (typeof document === 'undefined' || file.size <= MAX_UPLOAD_BYTES) {
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
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
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

    const preferJpeg = !/^image\/(png|webp|gif)$/i.test(file.type);
    const mime = preferJpeg ? 'image/jpeg' : file.type === 'image/png' ? 'image/jpeg' : file.type;
    const qualities = [0.85, 0.72, 0.6, 0.48];

    let best: Blob | null = null;
    for (const q of qualities) {
      const blob = await canvasToBlob(canvas, mime, q);
      if (!blob) continue;
      best = blob;
      if (blob.size <= MAX_UPLOAD_BYTES) break;
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

    if (best.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        `${file.name} is still too large after compression (${(best.size / (1024 * 1024)).toFixed(1)}MB). Try a smaller image.`,
      );
    }

    const base = (file.name || 'image').replace(/\.[^.]+$/, '');
    const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] || 'bin';
    const filename = `${base}.${ext}`;
    const dataUrl = await readAsDataUrl(best);
    return { blob: best, dataUrl, mime, filename, size: best.size };
  } catch (err) {
    if (err instanceof Error && /too large after compression/i.test(err.message)) throw err;
    // Fall back to original; upload path may still fail with a clear size error.
    return {
      blob: file,
      dataUrl: originalDataUrl,
      mime: file.type || 'application/octet-stream',
      filename: file.name || 'upload.bin',
      size: file.size,
    };
  }
}
