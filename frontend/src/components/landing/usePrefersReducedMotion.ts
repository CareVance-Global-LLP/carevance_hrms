import { useSyncExternalStore } from 'react';

/**
 * The single source of truth for "does this reader want motion".
 *
 * Before this existed there was ZERO reduced-motion handling anywhere in the
 * landing components — every scroll-scrub, parallax and tilt ran regardless of
 * the OS setting. For a reader with vestibular sensitivity a parallax hero is
 * not a preference, it is a reason to close the tab.
 *
 * `useSyncExternalStore` rather than `useState` + an effect, because the media
 * query can change WHILE the page is open: someone turning the setting on
 * mid-visit gets a re-render, not a page that keeps moving until reload.
 *
 * THE SERVER/FIRST SNAPSHOT IS `true` — i.e. reduced. This app is client
 * rendered, but the same rule earns its keep on the first paint: components
 * read this before the browser has laid anything out, and defaulting to "no
 * motion" means the state they render first is the FINISHED one. Everything
 * that animates therefore starts from its end state and is only hidden once we
 * know motion is wanted. The alternative — default to "animate" — renders every
 * section at `opacity: 0` for one frame, and leaves them there permanently if
 * anything throws before the effect runs. Failing visible is the only
 * acceptable direction to fail.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const getSnapshot = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;

const getServerSnapshot = () => true;

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
