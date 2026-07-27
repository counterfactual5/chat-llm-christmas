'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** Resolved visual theme applied to the document. */
export type ResolvedTheme = 'light' | 'dark';
/** User preference — `system` follows the device. */
export type ThemePreference = 'system' | ResolvedTheme;

const STORAGE_KEY = 'llm_christmas_theme';

type ThemeContextValue = {
  /** Resolved light/dark currently applied. */
  theme: ResolvedTheme;
  /** User preference (may be system). */
  preference: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  /** Cycle system → light → dark → system. */
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {}
  return null;
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [theme, setThemeState] = useState<ResolvedTheme>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initialPref = readStoredPreference() ?? 'system';
    const resolved = resolveTheme(initialPref);
    setPreferenceState(initialPref);
    setThemeState(resolved);
    applyTheme(resolved);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = mq.matches ? 'dark' : 'light';
      setThemeState(next);
      applyTheme(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference, ready]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    const resolved = resolveTheme(next);
    setThemeState(resolved);
    applyTheme(resolved);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const toggleTheme = useCallback(() => {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const idx = order.indexOf(preference);
    setTheme(order[(idx + 1) % order.length]!);
  }, [preference, setTheme]);

  const value = useMemo(
    () => ({ theme, preference, setTheme, toggleTheme }),
    [theme, preference, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
