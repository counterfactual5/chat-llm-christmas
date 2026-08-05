import type { KeyboardEvent, MutableRefObject } from 'react';

/**
 * True when Enter should NOT submit because an IME composition is active or
 * the confirming Enter is still in the same turn (Safari / macOS Chinese IME
 * often fire compositionend before the Enter keydown).
 */
export function isEnterSubmitBlockedByIme(
  e: KeyboardEvent,
  composingRef: MutableRefObject<boolean>,
  /** @deprecated Kept for call-site compatibility; no longer timed-locked. */
  _enterLockRef?: MutableRefObject<boolean>,
): boolean {
  return (
    e.nativeEvent.isComposing ||
    composingRef.current ||
    // IME-processed key (incl. Safari confirm Enter after compositionend).
    e.keyCode === 229
  );
}

/**
 * Textarea composition handlers that back {@link isEnterSubmitBlockedByIme}.
 *
 * On compositionend, defer clearing the composing flag to the next task so the
 * trailing confirm Enter (compositionend → keydown) is still blocked, while a
 * deliberate second Enter can send immediately — no multi-ms lock window.
 */
export function bindImeGuards(
  composingRef: MutableRefObject<boolean>,
  enterLockRef: MutableRefObject<boolean>,
) {
  return {
    onCompositionStart: () => {
      composingRef.current = true;
      enterLockRef.current = false;
    },
    onCompositionEnd: () => {
      // Do not clear composingRef synchronously: on macOS Chinese IME (esp.
      // confirming Latin text), browsers may fire compositionend before the
      // Enter keydown. setTimeout(0) keeps the guard for that one keydown only.
      setTimeout(() => {
        composingRef.current = false;
        enterLockRef.current = false;
      }, 0);
    },
  };
}
