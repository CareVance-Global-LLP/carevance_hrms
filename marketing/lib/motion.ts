/**
 * The whole motion vocabulary, as tokens.
 *
 * Six motions, defined once. A site with six consistent motions reads as
 * designed; a site with thirty reads as a demo reel. If a component needs a
 * seventh, that is a conversation, not an inline `transition={{ ... }}`.
 *
 * DIVISION OF LABOUR — and a deviation from the brief worth stating.
 *
 * §7.2 specifies motion/react as the primary library. It was, and then it was
 * measured: the navbar lives in the root layout, so its imports land in every
 * page's initial bundle, and the homepage came out at 236 KB gzipped against a
 * hard 180 KB budget. Roughly 45 KB of that was the animation library, carrying
 * six effects that are a transition and an IntersectionObserver each.
 *
 * §7.5 says a motion system that fails Core Web Vitals is a failed motion
 * system, and that budget is a hard gate. So the six motions are hand-rolled —
 * CSS transitions, one IntersectionObserver, one rAF lerp for the cursor — and
 * the dependency is gone. The vocabulary below is unchanged; only its
 * implementation is.
 *
 * anime.js v4 stays, for the one thing it is genuinely better at: the hero
 * chain's timeline-choreographed SVG path draw. It is dynamically imported
 * after first paint, so it never touches the critical path.
 */

/** The one curve. Everything else is a duration. */
export const EASE = [0.22, 0.61, 0.36, 1] as const;
export const EASE_CSS = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

export const DURATION = Object.freeze({
  /** 1 — Reveal. */
  reveal: 0.5,
  /** 2 — Stagger step between children. */
  stagger: 0.06,
  /** 3 — Count-up. */
  count: 1.2,
  /** 4 — Chain trace, the hero's connecting line. */
  trace: 1.4,
  /** 5 — Tab swap. */
  tab: 0.28,
  /** 6 — Hover lift. That is the whole hover language. */
  hover: 0.16,
});

/** Never stagger more than this many children — past it the tail reads as lag. */
export const STAGGER_CAP = 8;

/**
 * 1 — Reveal. Fires ONCE at 20% intersection and never re-triggers on scroll-up.
 * Re-triggering is the single most common way a scroll-reveal site starts to
 * feel cheap: content the reader has already seen should not re-animate.
 */
export const reveal = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DURATION.reveal, ease: EASE },
} as const;

export const VIEWPORT = Object.freeze({ once: true, amount: 0.2 });

/** 5 — Tab swap. Cross-fade plus an 8px slide, direction-aware. */
export const tabSwap = {
  initial: { opacity: 0, x: 8 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -8 },
  transition: { duration: DURATION.tab, ease: EASE },
} as const;

/** 6 — Hover lift. */
export const HOVER_LIFT_CLASS =
  'transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(0.22,0.61,0.36,1)] ' +
  'hover:-translate-y-0.5 hover:shadow-card-hover motion-reduce:hover:translate-y-0';

/**
 * Routes where the custom cursor is suppressed outright (brief §7.3).
 * Conversion surfaces and anything with a form keep the native pointer: losing
 * the I-beam over an input is the failure mode that makes a custom cursor feel
 * broken rather than crafted.
 */
export const CURSOR_BLOCKED_PREFIXES = Object.freeze([
  '/pricing',
  '/tools',
  '/contact',
  '/legal',
  '/security',
]);

export function cursorAllowedOnPath(pathname: string): boolean {
  return !CURSOR_BLOCKED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}
