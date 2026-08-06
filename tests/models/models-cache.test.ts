import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelOption } from '@/lib/chat/types';
import {
  MODELS_CACHE_HARD_TTL_MS,
  MODELS_CACHE_KEY,
  MODELS_CACHE_SOFT_TTL_MS,
  MODELS_CACHE_VERSION,
  clearModelsCache,
  isModelsCacheHardExpired,
  isModelsCacheSoftStale,
  readModelsCache,
  writeModelsCache,
} from '@/lib/models/models-cache';

const sample: ModelOption[] = [
  { id: 'glm-5.2-free', owned_by: 'zhipu', tier: 'free' },
  { id: 'kimi-k3', owned_by: 'moonshot', tier: 'paid' },
];

describe('models-cache', () => {
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

  it('writes and reads when authed matches', () => {
    writeModelsCache({ authed: false, models: sample });
    expect(readModelsCache({ authed: false })).toEqual(sample);
  });

  it('returns null when authed mismatches', () => {
    writeModelsCache({ authed: true, models: sample });
    expect(readModelsCache({ authed: false })).toBeNull();
  });

  it('returns null when hard-expired', () => {
    const now = 1_700_000_000_000;
    writeModelsCache({ authed: false, models: sample, now });
    expect(
      readModelsCache({
        authed: false,
        now: now + MODELS_CACHE_HARD_TTL_MS + 1,
      }),
    ).toBeNull();
  });

  it('still paints within hard TTL even if soft-stale', () => {
    const now = 1_700_000_000_000;
    writeModelsCache({ authed: false, models: sample, now });
    const later = now + MODELS_CACHE_SOFT_TTL_MS + 1;
    expect(isModelsCacheSoftStale(now, later)).toBe(true);
    expect(isModelsCacheHardExpired(now, later)).toBe(false);
    expect(readModelsCache({ authed: false, now: later })).toEqual(sample);
  });

  it('returns null for corrupt JSON or wrong version', () => {
    store.set(MODELS_CACHE_KEY, '{not-json');
    expect(readModelsCache({ authed: false })).toBeNull();
    store.set(
      MODELS_CACHE_KEY,
      JSON.stringify({
        v: MODELS_CACHE_VERSION + 1,
        at: Date.now(),
        authed: false,
        models: sample,
      }),
    );
    expect(readModelsCache({ authed: false })).toBeNull();
  });

  it('clearModelsCache removes the key', () => {
    writeModelsCache({ authed: false, models: sample });
    clearModelsCache();
    expect(store.get(MODELS_CACHE_KEY)).toBeUndefined();
    expect(readModelsCache({ authed: false })).toBeNull();
  });

  it('survives localStorage throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(readModelsCache({ authed: false })).toBeNull();
    expect(() =>
      writeModelsCache({ authed: false, models: sample }),
    ).not.toThrow();
    expect(() => clearModelsCache()).not.toThrow();
  });
});
