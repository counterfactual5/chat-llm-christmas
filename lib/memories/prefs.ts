/**
 * Client preference: whether the memory feature is on for this browser.
 * Account memories still exist on the server; this only gates auto-extract
 * and injection into chat system prompts.
 */

export const MEMORY_FEATURE_STORAGE_KEY = 'llm_christmas_memory_enabled';

/** Default ON so existing users keep current behavior. */
export function readMemoryFeatureEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(MEMORY_FEATURE_STORAGE_KEY);
    if (raw == null) return true;
    if (raw === '0' || raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

export function writeMemoryFeatureEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      MEMORY_FEATURE_STORAGE_KEY,
      enabled ? '1' : '0',
    );
  } catch {
    /* ignore quota / private mode */
  }
}
