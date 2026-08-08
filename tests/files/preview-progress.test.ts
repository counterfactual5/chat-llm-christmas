import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  clearPreviewScroll,
  clearPreviewScrollForFileId,
  loadPreviewScroll,
  savePreviewScroll,
} from '@/lib/files/preview-progress';

describe('preview-progress', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips scroll prefs', () => {
    savePreviewScroll('pdf', 'file_1', { scrollTop: 420, page: 3 });
    const loaded = loadPreviewScroll('pdf', 'file_1');
    expect(loaded?.scrollTop).toBe(420);
    expect(loaded?.page).toBe(3);
  });

  it('returns null for missing keys', () => {
    expect(loadPreviewScroll('url', 'https://example.com')).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    store.set('preview-scroll:v1:file:bad', '{not-json');
    expect(loadPreviewScroll('file', 'bad')).toBeNull();
  });

  it('clear removes key', () => {
    savePreviewScroll('tool', 'view_1', { scrollTop: 10 });
    clearPreviewScroll('tool', 'view_1');
    expect(loadPreviewScroll('tool', 'view_1')).toBeNull();
  });

  it('clearPreviewScrollForFileId clears file/pdf/sheet surfaces', () => {
    savePreviewScroll('file', 'f1', { scrollTop: 1 });
    savePreviewScroll('pdf', 'f1', { scrollTop: 2 });
    savePreviewScroll('sheet', 'f1', { scrollTop: 3 });
    savePreviewScroll('url', 'https://x', { scrollTop: 4 });
    clearPreviewScrollForFileId('f1');
    expect(loadPreviewScroll('file', 'f1')).toBeNull();
    expect(loadPreviewScroll('pdf', 'f1')).toBeNull();
    expect(loadPreviewScroll('sheet', 'f1')).toBeNull();
    expect(loadPreviewScroll('url', 'https://x')?.scrollTop).toBe(4);
  });
});
