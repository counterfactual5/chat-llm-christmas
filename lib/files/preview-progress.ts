/**
 * Persist side-Preview reading positions (scroll / optional page) per surface + id.
 * EPUB CFI + fonts stay in `epub-progress.ts`.
 */

export type PreviewScrollSurface = 'url' | 'file' | 'pdf' | 'tool' | 'sheet';

export type PreviewScrollPrefs = {
  scrollTop: number;
  scrollLeft?: number;
  page?: number;
  updatedAt: number;
};

const PREFIX = 'preview-scroll:v1:';

function storageKey(surface: PreviewScrollSurface, id: string): string {
  return `${PREFIX}${surface}:${String(id || '').trim()}`;
}

export function loadPreviewScroll(
  surface: PreviewScrollSurface,
  id: string,
): PreviewScrollPrefs | null {
  if (typeof window === 'undefined') return null;
  const keyId = String(id || '').trim();
  if (!keyId) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(surface, keyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PreviewScrollPrefs>;
    const scrollTop = Number(parsed.scrollTop);
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return null;
    const scrollLeft =
      parsed.scrollLeft == null
        ? undefined
        : Number(parsed.scrollLeft);
    const page =
      parsed.page == null ? undefined : Number(parsed.page);
    return {
      scrollTop,
      scrollLeft:
        scrollLeft != null && Number.isFinite(scrollLeft) && scrollLeft >= 0
          ? scrollLeft
          : undefined,
      page:
        page != null && Number.isFinite(page) && page >= 1
          ? Math.floor(page)
          : undefined,
      updatedAt:
        typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function savePreviewScroll(
  surface: PreviewScrollSurface,
  id: string,
  prefs: Omit<PreviewScrollPrefs, 'updatedAt'>,
): void {
  if (typeof window === 'undefined') return;
  const keyId = String(id || '').trim();
  if (!keyId) return;
  const scrollTop = Number(prefs.scrollTop);
  if (!Number.isFinite(scrollTop) || scrollTop < 0) return;
  try {
    const payload: PreviewScrollPrefs = {
      scrollTop,
      scrollLeft:
        prefs.scrollLeft != null &&
        Number.isFinite(prefs.scrollLeft) &&
        prefs.scrollLeft >= 0
          ? prefs.scrollLeft
          : undefined,
      page:
        prefs.page != null && Number.isFinite(prefs.page) && prefs.page >= 1
          ? Math.floor(prefs.page)
          : undefined,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey(surface, keyId), JSON.stringify(payload));
  } catch {
    // quota / private mode — ignore
  }
}

export function clearPreviewScroll(
  surface: PreviewScrollSurface,
  id: string,
): void {
  if (typeof window === 'undefined') return;
  const keyId = String(id || '').trim();
  if (!keyId) return;
  try {
    window.localStorage.removeItem(storageKey(surface, keyId));
  } catch {
    // ignore
  }
}

/** Clear all surfaces keyed by a deleted account file id. */
export function clearPreviewScrollForFileId(fileId: string): void {
  const id = String(fileId || '').trim();
  if (!id) return;
  for (const surface of ['file', 'pdf', 'sheet'] as const) {
    clearPreviewScroll(surface, id);
  }
}
