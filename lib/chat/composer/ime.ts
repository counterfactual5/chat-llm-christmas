import type { KeyboardEvent, MutableRefObject } from 'react';

/**
 * True when Enter should NOT submit because an IME composition is active or
 * just finished (the same Enter keypress that confirms composition often
 * also fires as a submit keydown on some IMEs/browsers).
 */
export function isEnterSubmitBlockedByIme(
  e: KeyboardEvent,
  composingRef: MutableRefObject<boolean>,
  enterLockRef: MutableRefObject<boolean>,
): boolean {
  return (
    e.nativeEvent.isComposing ||
    composingRef.current ||
    enterLockRef.current ||
    e.keyCode === 229
  );
}

/** Short lock window after composition ends, so the confirming Enter doesn't submit. */
const ENTER_LOCK_MS = 30;

/** Textarea composition handlers that back {@link isEnterSubmitBlockedByIme}. */
export function bindImeGuards(
  composingRef: MutableRefObject<boolean>,
  enterLockRef: MutableRefObject<boolean>,
) {
  return {
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
      enterLockRef.current = true;
      setTimeout(() => {
        enterLockRef.current = false;
      }, ENTER_LOCK_MS);
    },
  };
}
