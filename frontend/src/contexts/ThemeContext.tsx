import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Shared with the pre-paint script in index.html — keep the key in sync. */
export const THEME_STORAGE_KEY = 'carevance.theme';

const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#f8fafc',
  dark: '#0E141A',
};

interface ThemeContextValue {
  /** What the user picked, including 'system'. */
  choice: ThemeChoice;
  /** What is actually on screen right now. */
  theme: ResolvedTheme;
  setTheme: (choice: ThemeChoice) => void;
  /** Cycles light → dark → system, for a single-button toggle. */
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

const readStoredChoice = (): ThemeChoice => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private mode / storage disabled — fall through to the system default.
  }
  return 'system';
};

const resolve = (choice: ThemeChoice): ResolvedTheme =>
  choice === 'system' ? (prefersDark() ? 'dark' : 'light') : choice;

/** Applies the theme to <html>, which is what every CSS token keys off. */
const applyTheme = (theme: ResolvedTheme) => {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);

  // The Electron shell paints the window background and its own fallback
  // screens (load error, offline) outside this document, so they cannot see
  // the token layer. Push the *resolved* theme rather than the choice: the
  // shell then matches what is actually on screen, and 'system' flips arrive
  // here as a new resolved value anyway.
  void window.desktopTracker?.setTheme?.({ theme })?.catch?.(() => {
    // The shell keeps its last known theme; the web UI is already correct.
  });
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredChoice);
  const [theme, setResolved] = useState<ResolvedTheme>(() => resolve(readStoredChoice()));

  // Enabling transitions only after mount stops the whole page from animating
  // its colours on first paint, which reads as a flash of the wrong theme.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      document.documentElement.classList.add('theme-ready');
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Track the OS preference so 'system' stays live if the user flips it there.
  useEffect(() => {
    if (choice !== 'system') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    onChange();
    return () => query.removeEventListener('change', onChange);
  }, [choice]);

  // Keep other tabs of the app in step.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = readStoredChoice();
      setChoiceState(next);
      setResolved(resolve(next));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    setResolved(resolve(next));
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference just won't survive a reload; the UI still switches.
    }
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme(choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light');
  }, [choice, setTheme]);

  const value = useMemo(
    () => ({ choice, theme, setTheme, cycleTheme }),
    [choice, theme, setTheme, cycleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Theme access.
 *
 * Deliberately does not throw without a provider: the toggle is chrome that
 * legitimately renders in isolation (tests, the error boundary, the desktop
 * splash). Outside a provider it falls back to driving <html> and localStorage
 * directly, which is the same thing the provider ultimately does.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  const [standaloneChoice, setStandaloneChoice] = useState<ThemeChoice>(readStoredChoice);

  const standaloneSet = useCallback((next: ThemeChoice) => {
    setStandaloneChoice(next);
    applyTheme(resolve(next));
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference won't persist; the DOM is still updated.
    }
  }, []);

  const standalone = useMemo<ThemeContextValue>(() => {
    const theme = resolve(standaloneChoice);
    return {
      choice: standaloneChoice,
      theme,
      setTheme: standaloneSet,
      cycleTheme: () =>
        standaloneSet(
          standaloneChoice === 'light' ? 'dark' : standaloneChoice === 'dark' ? 'system' : 'light'
        ),
    };
  }, [standaloneChoice, standaloneSet]);

  return context ?? standalone;
}

/**
 * Theme access for components that may render outside the provider (error
 * boundaries, the desktop shell splash). Falls back to reading the DOM.
 */
export function useResolvedThemeSafe(): ResolvedTheme {
  const context = useContext(ThemeContext);
  const [fallback, setFallback] = useState<ResolvedTheme>(() =>
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light'
  );

  useEffect(() => {
    if (context) return undefined;
    const observer = new MutationObserver(() => {
      setFallback(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [context]);

  return context?.theme ?? fallback;
}
