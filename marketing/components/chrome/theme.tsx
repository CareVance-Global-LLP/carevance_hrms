'use client';

import { useEffect, useState } from 'react';

/**
 * Theme resolution, matching the product's model: "system" is resolved in JS
 * and written out as a `data-theme` attribute, so an explicit choice can beat
 * the OS preference and Tailwind's `dark:` variant has one thing to key off.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'carevance-theme';

/**
 * Runs BEFORE first paint, injected into <head> as a blocking script.
 *
 * It has to be inline and synchronous. Anything deferred — a client component's
 * effect, a module import — runs after the first paint, and the reader watches
 * a white page flip to dark. Minified by hand because this is bytes on the
 * critical path for every route, and wrapped in try/catch because a browser
 * with storage disabled must fall back to the OS preference rather than
 * throwing before the app has rendered anything at all.
 */
export const themeScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var s=localStorage.getItem(k);var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var t=(s==="light"||s==="dark")?s:(d?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const initial: ThemeChoice = stored === 'light' || stored === 'dark' ? stored : 'system';
    setChoice(initial);

    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = (next: ThemeChoice) => {
      const value = next === 'system' ? (media.matches ? 'dark' : 'light') : next;
      document.documentElement.setAttribute('data-theme', value);
      setResolved(value);
    };

    apply(initial);

    // Only follow the OS while the reader has not made a choice of their own.
    const onSystemChange = () => {
      const current = localStorage.getItem(THEME_STORAGE_KEY);
      if (current !== 'light' && current !== 'dark') apply('system');
    };
    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, []);

  const set = (next: ThemeChoice) => {
    setChoice(next);
    if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, next);

    const value =
      next === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : next;
    document.documentElement.setAttribute('data-theme', value);
    setResolved(value);
  };

  return { choice, resolved, set };
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolved, set } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const next = resolved === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => set(next)}
      // Before hydration the server does not know which theme the inline script
      // chose, so the label would be a coin flip. Announce the generic action
      // until we do know, rather than announcing the wrong one.
      aria-label={mounted ? `Switch to ${next} theme` : 'Switch theme'}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-n-600 transition-colors hover:bg-n-100 hover:text-n-800 ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {mounted && resolved === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        )}
      </svg>
    </button>
  );
}
