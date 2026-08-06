'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { selectionActiveInRoot } from '@/lib/chat/message/quote-roots';

/**
 * While `enabled` and the user has an active selection inside `rootRef`,
 * keep returning the last pre-selection text so ReactMarkdown / KaTeX do not
 * remount under the caret (macOS three-finger drag + live streaming).
 *
 * Incoming `text` still updates in a ref and is applied when the selection ends.
 */
export function useSelectionFrozenText(
  text: string,
  enabled: boolean,
  rootRef: RefObject<HTMLElement | null>,
): string {
  const latestRef = useRef(text);
  latestRef.current = text;
  const frozenRef = useRef(false);
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    if (!enabled) {
      frozenRef.current = false;
      setDisplay(text);
      return;
    }
    if (!frozenRef.current) setDisplay(text);
  }, [text, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const sync = () => {
      const active = selectionActiveInRoot(rootRef.current);
      if (active) {
        frozenRef.current = true;
        return;
      }
      if (frozenRef.current) {
        frozenRef.current = false;
        setDisplay(latestRef.current);
      }
    };

    document.addEventListener('selectionchange', sync);
    document.addEventListener('pointerup', sync);
    document.addEventListener('pointercancel', sync);
    sync();
    return () => {
      document.removeEventListener('selectionchange', sync);
      document.removeEventListener('pointerup', sync);
      document.removeEventListener('pointercancel', sync);
    };
  }, [enabled, rootRef]);

  return enabled ? display : text;
}
