import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent } from 'react';
import { bindImeGuards, isEnterSubmitBlockedByIme } from '@/lib/chat/composer/ime';

function keyEvent(overrides: Partial<{ isComposing: boolean; keyCode: number }> = {}) {
  return {
    nativeEvent: { isComposing: overrides.isComposing ?? false },
    keyCode: overrides.keyCode ?? 13,
  } as unknown as KeyboardEvent;
}

describe('isEnterSubmitBlockedByIme', () => {
  it('blocks when the native event reports composing', () => {
    const composing = { current: false };
    const lock = { current: false };
    expect(isEnterSubmitBlockedByIme(keyEvent({ isComposing: true }), composing, lock)).toBe(true);
  });

  it('blocks when the composing ref is set', () => {
    const composing = { current: true };
    const lock = { current: false };
    expect(isEnterSubmitBlockedByIme(keyEvent(), composing, lock)).toBe(true);
  });

  it('blocks on the legacy IME keyCode 229', () => {
    const composing = { current: false };
    const lock = { current: false };
    expect(isEnterSubmitBlockedByIme(keyEvent({ keyCode: 229 }), composing, lock)).toBe(true);
  });

  it('does not block plain Enter presses', () => {
    const composing = { current: false };
    const lock = { current: false };
    expect(isEnterSubmitBlockedByIme(keyEvent(), composing, lock)).toBe(false);
  });

  it('ignores enterLockRef (no timed lock)', () => {
    const composing = { current: false };
    const lock = { current: true };
    expect(isEnterSubmitBlockedByIme(keyEvent(), composing, lock)).toBe(false);
  });
});

describe('bindImeGuards', () => {
  it('keeps composing true through compositionend until the next task', () => {
    vi.useFakeTimers();
    try {
      const composing = { current: false };
      const lock = { current: false };
      const { onCompositionStart, onCompositionEnd } = bindImeGuards(composing, lock);

      onCompositionStart();
      expect(composing.current).toBe(true);

      onCompositionEnd();
      // Same turn as confirm Enter keydown — still blocked.
      expect(composing.current).toBe(true);
      expect(isEnterSubmitBlockedByIme(keyEvent(), composing, lock)).toBe(true);

      vi.runAllTimers();
      // Next Enter can send immediately.
      expect(composing.current).toBe(false);
      expect(isEnterSubmitBlockedByIme(keyEvent(), composing, lock)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
