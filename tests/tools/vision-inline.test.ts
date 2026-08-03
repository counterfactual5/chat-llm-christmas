import { describe, expect, it } from 'vitest';
import {
  MAX_VISION_INLINE_BYTES,
  MAX_VISION_PASSTHROUGH_BYTES,
  fitDataUrlForVision,
  fitImageBytesForVision,
} from '@/lib/tools/image-understand/vision-inline';

describe('vision inline guard', () => {
  it('passes through small buffers unchanged', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const out = await fitImageBytesForVision(bytes, 'image/jpeg');
    expect(out.bytes).toBe(bytes);
    expect(out.mime).toBe('image/jpeg');
  });

  it('leaves small data URLs alone', async () => {
    const dataUrl = 'data:image/jpeg;base64,AAAA';
    await expect(fitDataUrlForVision(dataUrl)).resolves.toBe(dataUrl);
  });

  it('exports a vision budget below typical phone originals', () => {
    expect(MAX_VISION_INLINE_BYTES).toBeLessThan(5 * 1024 * 1024);
    expect(MAX_VISION_INLINE_BYTES).toBeGreaterThan(500_000);
    expect(MAX_VISION_PASSTHROUGH_BYTES).toBeGreaterThan(MAX_VISION_INLINE_BYTES);
  });

  it('passthrough oversized images under hard cap when runtime cannot compress', async () => {
    const bytes = new Uint8Array(MAX_VISION_INLINE_BYTES + 1);
    const out = await fitImageBytesForVision(bytes, 'image/jpeg');
    expect(out.bytes.byteLength).toBe(bytes.byteLength);
  });

  it('rejects images above the hard passthrough cap when runtime cannot compress', async () => {
    const bytes = new Uint8Array(MAX_VISION_PASSTHROUGH_BYTES + 1);
    await expect(fitImageBytesForVision(bytes, 'image/jpeg')).rejects.toThrow(
      /cannot downscale|vision inline limit/i,
    );
  });
});
