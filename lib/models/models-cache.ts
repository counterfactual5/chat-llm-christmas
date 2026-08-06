/**
 * Browser snapshot of /api/models for warm boot (SWR).
 * Hard TTL gates paint; soft TTL reserved for future stale UI hints.
 */

import type { ModelOption } from '@/lib/chat/types';

export const MODELS_CACHE_KEY = 'llm_christmas_models_cache';
export const MODELS_CACHE_VERSION = 1;
export const MODELS_CACHE_SOFT_TTL_MS = 60 * 60 * 1000; // 1h
export const MODELS_CACHE_HARD_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d

export type ModelsCachePayload = {
  v: number;
  at: number;
  authed: boolean;
  models: ModelOption[];
};

function isModelOption(value: unknown): value is ModelOption {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return typeof m.id === 'string' && m.id.length > 0;
}

function parsePayload(raw: string): ModelsCachePayload | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;
    if (obj.v !== MODELS_CACHE_VERSION) return null;
    if (typeof obj.at !== 'number' || !Number.isFinite(obj.at)) return null;
    if (typeof obj.authed !== 'boolean') return null;
    if (!Array.isArray(obj.models)) return null;
    const models = obj.models.filter(isModelOption);
    if (models.length === 0) return null;
    return { v: MODELS_CACHE_VERSION, at: obj.at, authed: obj.authed, models };
  } catch {
    return null;
  }
}

/** Soft-stale but still paintable (within hard TTL). */
export function isModelsCacheSoftStale(at: number, now = Date.now()): boolean {
  return now - at >= MODELS_CACHE_SOFT_TTL_MS;
}

export function isModelsCacheHardExpired(at: number, now = Date.now()): boolean {
  return now - at >= MODELS_CACHE_HARD_TTL_MS;
}

/**
 * Return cached models when auth scope matches and hard TTL has not elapsed.
 */
export function readModelsCache(opts: {
  authed: boolean;
  now?: number;
}): ModelOption[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MODELS_CACHE_KEY);
    if (raw == null) return null;
    const payload = parsePayload(raw);
    if (!payload) return null;
    if (payload.authed !== opts.authed) return null;
    if (isModelsCacheHardExpired(payload.at, opts.now ?? Date.now())) return null;
    return payload.models;
  } catch {
    return null;
  }
}

export function writeModelsCache(opts: {
  authed: boolean;
  models: ModelOption[];
  now?: number;
}): void {
  if (typeof window === 'undefined') return;
  if (!opts.models?.length) return;
  try {
    const payload: ModelsCachePayload = {
      v: MODELS_CACHE_VERSION,
      at: opts.now ?? Date.now(),
      authed: opts.authed,
      models: opts.models,
    };
    window.localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearModelsCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(MODELS_CACHE_KEY);
  } catch {
    /* ignore */
  }
}
