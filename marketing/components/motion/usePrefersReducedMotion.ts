'use client';

import { useSyncExternalStore } from 'react';

/**
 * The single source of truth for "does this reader want motion".
 *
 * `useSyncExternalStore` rather than `useState` + an effect, because the media
 * query can change WHILE the page is open — a reader turning the OS setting on
 * mid-visit gets a re-render, not a page that keeps animating until reload.
 *
 * THE SERVER SNAPSHOT IS `true` — i.e. reduced. The server cannot know the
 * reader's preference, so it renders the state that is correct either way: the
 * finished, static one. Everything that animates therefore ships its END STATE
 * in the HTML and is only hidden after hydration, for readers who asked for
 * motion. The alternative — server-render the hidden state — leaves the page
 * permanently blank for anyone whose JS fails. Failing visible is the only
 * acceptable direction to fail, and it is the same rule ChainHero follows.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;
const getServerSnapshot = () => true;

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
