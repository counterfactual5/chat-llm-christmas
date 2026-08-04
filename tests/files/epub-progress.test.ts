import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  EPUB_DEFAULT_FONT_FAMILY,
  EPUB_DEFAULT_FONT_SIZE,
  loadEpubReaderPrefs,
  saveEpubReaderPrefs,
} from '@/lib/files/epub-progress';

describe('epub-progress', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips cfi and font prefs', () => {
    saveEpubReaderPrefs('file_1', {
      cfi: 'epubcfi(/6/2)',
      fontSize: '120%',
      fontFamily: 'sans',
    });
    const loaded = loadEpubReaderPrefs('file_1');
    expect(loaded?.cfi).toBe('epubcfi(/6/2)');
    expect(loaded?.fontSize).toBe('120%');
    expect(loaded?.fontFamily).toBe('sans');
  });

  it('returns defaults-friendly null for missing keys', () => {
    expect(loadEpubReaderPrefs('missing')).toBeNull();
    saveEpubReaderPrefs('file_2', {
      fontSize: EPUB_DEFAULT_FONT_SIZE,
      fontFamily: EPUB_DEFAULT_FONT_FAMILY,
    });
    expect(loadEpubReaderPrefs('file_2')?.fontSize).toBe(EPUB_DEFAULT_FONT_SIZE);
  });
});
