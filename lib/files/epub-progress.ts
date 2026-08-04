/** Persist EPUB reading position + font prefs per file id (localStorage). */

export type EpubReaderPrefs = {
  cfi?: string;
  fontSize: string;
  fontFamily: string;
  updatedAt: number;
};

const PREFIX = 'epub-progress:v1:';
export const EPUB_DEFAULT_FONT_SIZE = '100%';
export const EPUB_DEFAULT_FONT_FAMILY = 'serif';

export const EPUB_FONT_SIZES = ['90%', '100%', '120%', '140%', '160%'] as const;
export const EPUB_FONT_FAMILIES = [
  { id: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { id: 'sans', label: 'Sans', css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { id: 'mono', label: 'Mono', css: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
] as const;

function storageKey(fileId: string): string {
  return `${PREFIX}${String(fileId || '').trim()}`;
}

export function loadEpubReaderPrefs(fileId: string): EpubReaderPrefs | null {
  if (typeof window === 'undefined') return null;
  const id = String(fileId || '').trim();
  if (!id) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EpubReaderPrefs>;
    return {
      cfi: typeof parsed.cfi === 'string' ? parsed.cfi : undefined,
      fontSize:
        typeof parsed.fontSize === 'string' && parsed.fontSize
          ? parsed.fontSize
          : EPUB_DEFAULT_FONT_SIZE,
      fontFamily:
        typeof parsed.fontFamily === 'string' && parsed.fontFamily
          ? parsed.fontFamily
          : EPUB_DEFAULT_FONT_FAMILY,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveEpubReaderPrefs(fileId: string, prefs: Omit<EpubReaderPrefs, 'updatedAt'>): void {
  if (typeof window === 'undefined') return;
  const id = String(fileId || '').trim();
  if (!id) return;
  try {
    const payload: EpubReaderPrefs = {
      cfi: prefs.cfi,
      fontSize: prefs.fontSize || EPUB_DEFAULT_FONT_SIZE,
      fontFamily: prefs.fontFamily || EPUB_DEFAULT_FONT_FAMILY,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey(id), JSON.stringify(payload));
  } catch {
    // quota / private mode — ignore
  }
}

export function fontFamilyCss(id: string): string {
  const hit = EPUB_FONT_FAMILIES.find((f) => f.id === id);
  return hit?.css || EPUB_FONT_FAMILIES[0].css;
}
