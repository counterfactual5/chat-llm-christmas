import { describe, expect, it, vi } from 'vitest';

describe('extractZipTextFromBytes: pre-decompress uncompressedSize guard', () => {
  it('skips entry.async when declared uncompressedSize would overflow', async () => {
    vi.resetModules();

    const entryAsync1 = vi.fn(async () => new Uint8Array(8));
    const entryAsync2 = vi.fn(async () => new Uint8Array(5));

    const fakeZip = {
      files: {
        'a.txt': {
          dir: false,
          async: entryAsync1,
          _data: { uncompressedSize: 8 },
        },
        'b.txt': {
          dir: false,
          async: entryAsync2,
          _data: { uncompressedSize: 5 },
        },
      },
    };

    vi.doMock('jszip', () => ({
      default: {
        loadAsync: vi.fn(async () => fakeZip),
      },
    }));

    vi.doMock('@/lib/files/paged-extract', async () => {
      const actual = await vi.importActual<any>('@/lib/files/paged-extract');
      return {
        ...actual,
        MAX_ZIP_UNCOMPRESSED_BYTES: 10,
        MAX_ZIP_LISTED_ENTRIES: 500,
        MAX_PAGED_CONTENT_UNITS: 40,
      };
    });

    const Extractors = await import('@/lib/files/ingest/extractors');

    const text = await Extractors.extractZipTextFromBytes(new Uint8Array([1, 2, 3]), {
      archiveName: 't.zip',
    });

    expect(entryAsync1).toHaveBeenCalledTimes(1);
    // If the pre-check works, the second entry should never be decoded/decompressed.
    expect(entryAsync2).toHaveBeenCalledTimes(0);

    expect(text).toContain('b.txt');
    expect(text).toContain('skipped: uncompressed size limit');
  });

  it('fails closed (skips entry.async) when uncompressedSize metadata is missing', async () => {
    vi.resetModules();

    const entryAsync = vi.fn(async () => new Uint8Array(5));

    const fakeZip = {
      files: {
        'a.txt': {
          dir: false,
          async: entryAsync,
          _data: {},
        },
      },
    };

    vi.doMock('jszip', () => ({
      default: {
        loadAsync: vi.fn(async () => fakeZip),
      },
    }));

    vi.doMock('@/lib/files/paged-extract', async () => {
      const actual = await vi.importActual<any>('@/lib/files/paged-extract');
      return {
        ...actual,
        MAX_ZIP_UNCOMPRESSED_BYTES: 10,
        MAX_ZIP_LISTED_ENTRIES: 500,
        MAX_PAGED_CONTENT_UNITS: 40,
      };
    });

    const Extractors = await import('@/lib/files/ingest/extractors');

    const text = await Extractors.extractZipTextFromBytes(new Uint8Array([1, 2, 3]), {
      archiveName: 't.zip',
    });

    expect(entryAsync).toHaveBeenCalledTimes(0);
    expect(text).toContain('a.txt');
    expect(text).toContain('skipped: uncompressed size limit');
  });
});

