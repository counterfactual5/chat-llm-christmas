import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEMORY_FEATURE_STORAGE_KEY,
  readMemoryFeatureEnabled,
  writeMemoryFeatureEnabled,
} from '@/lib/memories/prefs';

describe('memory feature prefs', () => {
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

  it('defaults to enabled when unset', () => {
    expect(readMemoryFeatureEnabled()).toBe(true);
  });

  it('persists off and on', () => {
    writeMemoryFeatureEnabled(false);
    expect(store.get(MEMORY_FEATURE_STORAGE_KEY)).toBe('0');
    expect(readMemoryFeatureEnabled()).toBe(false);

    writeMemoryFeatureEnabled(true);
    expect(store.get(MEMORY_FEATURE_STORAGE_KEY)).toBe('1');
    expect(readMemoryFeatureEnabled()).toBe(true);
  });
});
