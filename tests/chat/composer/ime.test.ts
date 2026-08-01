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

  it('blocks when the enter lock ref is set', () => {
    const composing = { current: false };
    const lock = { current: true };
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
});

describe('bindImeGuards', () => {
  it('flips the composing ref while composition is active', () => {
    const composing = { current: false };
    const lock = { current: false };
    const { onCompositionStart, onCompositionEnd } = bindImeGuards(composing, lock);

    onCompositionStart();
    expect(composing.current).toBe(true);

    onCompositionEnd();
    expect(composing.current).toBe(false);
  });

  it('locks Enter briefly after composition ends, then releases it', () => {
    vi.useFakeTimers();
    try {
      const composing = { current: false };
      const lock = { current: false };
      const { onCompositionEnd } = bindImeGuards(composing, lock);

      onCompositionEnd();
      expect(lock.current).toBe(true);

      vi.advanceTimersByTime(29);
      expect(lock.current).toBe(true);

      vi.advanceTimersByTime(1);
      expect(lock.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
