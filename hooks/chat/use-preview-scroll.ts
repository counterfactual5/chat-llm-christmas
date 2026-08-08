'use client';

import { useEffect, useRef, type RefObject } from 'react';
import {
  loadPreviewScroll,
  savePreviewScroll,
  type PreviewScrollSurface,
} from '@/lib/files/preview-progress';

const SAVE_DEBOUNCE_MS = 400;

/**
 * Persist scrollTop(/Left) for a Preview overflow container.
 * Restores once per surface+id when the element mounts / id changes.
 */
export function usePersistedPreviewScroll(
  surface: PreviewScrollSurface,
  id: string | null | undefined,
  enabled = true,
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const restoredForRef = useRef<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    const keyId = String(id || '').trim();
    if (!el || !keyId || !enabled) return;

    const restoreKey = `${surface}:${keyId}`;
    if (restoredForRef.current !== restoreKey) {
      const prefs = loadPreviewScroll(surface, keyId);
      if (prefs) {
        el.scrollTop = prefs.scrollTop;
        if (prefs.scrollLeft != null) el.scrollLeft = prefs.scrollLeft;
      }
      restoredForRef.current = restoreKey;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const persist = () => {
      savePreviewScroll(surface, keyId, {
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
      });
    };
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(persist, SAVE_DEBOUNCE_MS);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
      persist();
    };
  }, [surface, id, enabled]);

  return ref;
}
