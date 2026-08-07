import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureFileExtractSidecar,
  isFileExtractSidecarReady,
  resetSharedFileExtractWaitsForTests,
  waitForFileExtractSidecar,
  waitForSharedFileExtractSidecar,
} from '@/lib/files/ensure-file-extract';
import { previewStateFromExtractWait } from '@/lib/files/extract-sidecar-preview';

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
    expect(
      isFileExtractSidecarReady({
        partial: false,
        text: '',
        epub_image_pages: [1],
      }),
    ).toBe(true);
    expect(
      isFileExtractSidecarReady({
        partial: false,
        text: '',
        pptx_image_slides: [0, 2],
      }),
    ).toBe(true);
  });
});

describe('previewStateFromExtractWait', () => {
  it('maps success, empty, abort, and failure', () => {
    expect(
      previewStateFromExtractWait(
        { ok: true, text: 'hello', partial: false },
        'failed',
      ),
    ).toEqual({ status: 'ready', content: 'hello' });
    expect(
      previewStateFromExtractWait(
        { ok: true, text: '  ', partial: false, needsOcr: true },
        'failed',
      ),
    ).toEqual({ status: 'failed', error: 'failed' });
    expect(
      previewStateFromExtractWait(
        { ok: false, code: 'ABORTED', error: 'Aborted' },
        'failed',
      ),
    ).toEqual({ status: 'aborted' });
    expect(
      previewStateFromExtractWait(
        { ok: false, code: 'TIMEOUT', error: 'Timed out' },
        'failed',
      ),
    ).toEqual({ status: 'failed', error: 'Timed out' });
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
    resetSharedFileExtractWaitsForTests();
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
      needsOcr: false,
      pagesNeedingOcr: [],
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

  it('treats pptx_image_slides-only payload as ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          text: '',
          chars: 0,
          partial: false,
          pptx_image_slides: [0, 1],
        }),
      ),
    );
    await expect(
      waitForFileExtractSidecar({
        fileId: 'deck',
        intervalMs: 50,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      ok: true,
      text: '',
      partial: false,
      needsOcr: true,
      pagesNeedingOcr: [0, 1],
    });
  });

  it('returns EXTRACT_EMPTY when finished with no text or OCR meta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ text: '', chars: 0, partial: false })),
    );
    await expect(
      waitForFileExtractSidecar({
        fileId: 'empty',
        intervalMs: 50,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'EXTRACT_EMPTY',
    });
  });

  it('fails immediately on HTTP 404 / FILE_NOT_FOUND', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ code: 'FILE_NOT_FOUND', message: 'gone' }, 404),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      waitForFileExtractSidecar({
        fileId: 'missing',
        intervalMs: 50,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'FILE_NOT_FOUND',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on EXTRACT_FAILED without polling to TIMEOUT', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ code: 'EXTRACT_FAILED', message: 'corrupt' }, 422),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      waitForFileExtractSidecar({
        fileId: 'bad',
        intervalMs: 50,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'EXTRACT_FAILED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts a hung extract GET when timeoutMs elapses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          if (signal.aborted) {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            return;
          }
          signal.addEventListener(
            'abort',
            () =>
              reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
            { once: true },
          );
        });
      }),
    );

    const pending = waitForFileExtractSidecar({
      fileId: 'hung',
      intervalMs: 50,
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'TIMEOUT',
    });
  });
});

describe('waitForSharedFileExtractSidecar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSharedFileExtractWaitsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    resetSharedFileExtractWaitsForTests();
  });

  it('coalesces concurrent waiters for the same fileId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ text: '', chars: 0, partial: true }))
      .mockResolvedValueOnce(
        jsonResponse({ text: 'shared body', chars: 11, partial: false }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const a = waitForSharedFileExtractSidecar({
      fileId: 'same',
      intervalMs: 50,
      timeoutMs: 5_000,
    });
    const b = waitForSharedFileExtractSidecar({
      fileId: 'same',
      intervalMs: 50,
      timeoutMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(60);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toMatchObject({ ok: true, text: 'shared body' });
    expect(rb).toMatchObject({ ok: true, text: 'shared body' });
    // One shared poller: first GET + second GET after interval (not 2×2).
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('does not abort shared wait when one caller releases early', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ text: '', chars: 0, partial: true }))
      .mockResolvedValueOnce(
        jsonResponse({ text: 'kept alive', chars: 10, partial: false }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const previewAc = new AbortController();
    const preview = waitForSharedFileExtractSidecar({
      fileId: 'keep',
      intervalMs: 50,
      timeoutMs: 5_000,
      signal: previewAc.signal,
    });
    const attach = waitForSharedFileExtractSidecar({
      fileId: 'keep',
      intervalMs: 50,
      timeoutMs: 5_000,
    });

    previewAc.abort();
    await expect(preview).resolves.toMatchObject({ code: 'ABORTED' });

    await vi.advanceTimersByTimeAsync(60);
    await expect(attach).resolves.toMatchObject({
      ok: true,
      text: 'kept alive',
    });
  });
});
