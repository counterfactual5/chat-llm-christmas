import { describe, expect, it, vi } from 'vitest';
import {
  attemptLiteratureEphemeralPreview,
  literatureContentLooksPreviewable,
  literaturePreviewKindsForUrl,
  mimeFromLiteratureContentType,
  persistLiteraturePreview,
} from '@/lib/files/literature-preview-ladder';
import {
  identifierFromEphemeralPreviewId,
  kindFromEphemeralPreviewId,
} from '@/lib/files/ephemeral-preview';

describe('literature preview ladder helpers', () => {
  it('orders paper before book when both gates match a pdf URL', () => {
    expect(literaturePreviewKindsForUrl('https://cdn.example/a.pdf')).toEqual([
      'paper',
      'book',
    ]);
    expect(
      literaturePreviewKindsForUrl(
        'https://libgen.li/ads.php?md5=f370d2605d3cc160902406c9724c00ef',
      ),
    ).toEqual(['book']);
  });

  it('sniffs previewable content types per kind', () => {
    expect(literatureContentLooksPreviewable('paper', 'application/pdf')).toBe(
      true,
    );
    expect(literatureContentLooksPreviewable('paper', 'application/epub+zip')).toBe(
      false,
    );
    expect(literatureContentLooksPreviewable('book', 'application/epub+zip')).toBe(
      true,
    );
    expect(mimeFromLiteratureContentType('book', 'application/pdf')).toBe(
      'application/pdf',
    );
  });

  it('returns ephemeral when resolve+probe succeed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    const outcome = await attemptLiteratureEphemeralPreview({
      kind: 'paper',
      url: 'https://arxiv.org/pdf/1706.03762.pdf',
      title: 'Attention',
      resolve: async () => ({
        ok: true,
        title: 'Attention',
        filename: 'Attention.pdf',
      }),
      downloadOnlyFallback: 'download-only',
      resolveFailFallback: 'no-file',
    });
    expect(outcome.outcome).toBe('ephemeral');
    if (outcome.outcome === 'ephemeral') {
      expect(outcome.entry.mimeType).toBe('application/pdf');
      expect(outcome.entry.url).toContain('/api/literature/papers/content?');
    }
    fetchSpy.mockRestore();
  });

  it('returns download_only when resolve ok but content is not previewable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'NOT_PDF' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const outcome = await attemptLiteratureEphemeralPreview({
      kind: 'paper',
      url: 'https://doi.org/10.1000/xyz',
      resolve: async () => ({ ok: true, title: 'Paywalled' }),
      downloadOnlyFallback: 'download-only',
      resolveFailFallback: 'no-file',
    });
    expect(outcome).toEqual({
      outcome: 'download_only',
      message: 'download-only',
    });
    fetchSpy.mockRestore();
  });

  it('returns cta for junk book resolve failures and fallthrough otherwise', async () => {
    const junk = await attemptLiteratureEphemeralPreview({
      kind: 'book',
      url: 'https://libgen.li/ads.php?md5=f370d2605d3cc160902406c9724c00ef',
      resolve: async () => ({ ok: false, error: 'gone' }),
      downloadOnlyFallback: 'download-only',
      resolveFailFallback: 'no-book',
    });
    expect(junk).toEqual({ outcome: 'cta', message: 'gone' });

    const soft = await attemptLiteratureEphemeralPreview({
      kind: 'book',
      url: 'https://archive.org/details/aliceinwonderland00carrrich',
      resolve: async () => ({ ok: false, error: 'gone' }),
      downloadOnlyFallback: 'download-only',
      resolveFailFallback: 'no-book',
    });
    expect(soft).toEqual({ outcome: 'fallthrough' });
  });

  it('persists literature download into a Files preview entry', async () => {
    const saved = await persistLiteraturePreview({
      kind: 'book',
      identifier: 'libgen:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      download: async () => ({
        ok: true,
        fileId: 'file-1',
        filename: 'x.pdf',
        title: 'X',
        bytes: 12,
      }),
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.entry.id).toBe('file-1');
      expect(saved.entry.url).toBe('/api/files/file-1');
      expect(saved.entry.messageId).toBe('url-preview-book');
    }
  });

  it('decodes ephemeral id helpers', () => {
    const id = `paper-preview:${encodeURIComponent('https://doi.org/10.1/x')}`;
    expect(kindFromEphemeralPreviewId(id)).toBe('paper');
    expect(identifierFromEphemeralPreviewId(id, 'paper')).toBe(
      'https://doi.org/10.1/x',
    );
  });
});
