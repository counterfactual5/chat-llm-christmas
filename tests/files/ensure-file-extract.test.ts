import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureFileExtractSidecar,
  isFileExtractSidecarReady,
  waitForFileExtractSidecar,
} from '@/lib/files/ensure-file-extract';

vi.mock('@/lib/files/direct-upload', () => ({
  fetchUploadTicket: vi.fn(async () => ({
    uploadToken: 'tok',
    uploadUrl: 'https://api.example/v1/files',
    maxBytes: 1_000_000,
    expiresAt: Date.now() + 60_000,
  })),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('isFileExtractSidecarReady', () => {
  it('requires partial === false plus text or OCR meta', () => {
    expect(isFileExtractSidecarReady({ partial: true, text: 'hi' })).toBe(false);
    expect(isFileExtractSidecarReady({ partial: false, text: 'hi' })).toBe(true);
    expect(isFileExtractSidecarReady({ partial: false, text: '  ' })).toBe(false);
    expect(
      isFileExtractSidecarReady({ partial: false, text: '', needs_ocr: true }),
    ).toBe(true);
    expect(
      isFileExtractSidecarReady({
        partial: false,
        text: '',
        pages_needing_ocr: [2, 3],
      }),
    ).toBe(true);
  });
});

describe('ensureFileExtractSidecar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns chars from a single GET', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ text: 'abc', chars: 3, partial: false })),
    );
    await expect(ensureFileExtractSidecar({ fileId: 'f1' })).resolves.toEqual({
      ok: true,
      chars: 3,
    });
  });

  it('rejects missing fileId', async () => {
    await expect(ensureFileExtractSidecar({ fileId: '  ' })).resolves.toEqual({
      ok: false,
      error: 'missing fileId',
    });
  });
});

describe('waitForFileExtractSidecar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('resolves after partial flips to false with text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ text: '', chars: 0, partial: true }))
      .mockResolvedValueOnce(
        jsonResponse({ text: 'chapter one', chars: 11, partial: false }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const pending = waitForFileExtractSidecar({
      fileId: 'doc-1',
      intervalMs: 50,
      timeoutMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toEqual({
      ok: true,
      text: 'chapter one',
      chars: 11,
      partial: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out while still partial', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ text: '', chars: 0, partial: true })),
    );

    const pending = waitForFileExtractSidecar({
      fileId: 'slow',
      intervalMs: 50,
      timeoutMs: 120,
    });
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'TIMEOUT',
    });
  });

  it('exits cleanly on AbortSignal without unhandled rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ text: '', chars: 0, partial: true })),
    );
    const ac = new AbortController();
    const pending = waitForFileExtractSidecar({
      fileId: 'abort-me',
      intervalMs: 50,
      timeoutMs: 5_000,
      signal: ac.signal,
    });
    ac.abort();
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toEqual({
      ok: false,
      error: 'Aborted',
      code: 'ABORTED',
    });
  });
});
