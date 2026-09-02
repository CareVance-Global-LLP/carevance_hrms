'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/components/ui/primitives';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

/**
 * Motion 5 — tab swap. The homepage's capability section.
 *
 * Confirmed as the category's best-in-class pattern and far better than a
 * ten-row alternating feature stack, which reads as a spec sheet and gets
 * scrolled past.
 *
 * Real ARIA tabs, not styled buttons: roving tabindex, arrow-key navigation,
 * Home/End, and `aria-controls` pointing at a labelled panel. A tab strip that
 * cannot be driven from the keyboard is a carousel wearing a costume.
 *
 * THE PILL IS A SHARED LAYOUT TRANSITION. One `layoutId`, rendered inside
 * whichever tab is active — motion sees the same identity mount in a new place
 * and animates the difference. The element physically travels between tabs
 * rather than a separate absolutely-positioned bar being told where to go.
 *
 * This replaces a hand-measured transform (two refs, `offsetLeft`/`offsetWidth`
 * and a ResizeObserver to survive the strip wrapping at narrow widths). The
 * shared-layout version is fewer moving parts and cannot fall out of sync with
 * a re-flow, because it re-measures on every layout change by construction.
 *
 * THE PANEL SWAP IS DIRECTION-AWARE. Content enters from the side the reader
 * came from — moving right sends the new panel in from the right. A swap that
 * always animates the same way tells the reader nothing about where they are in
 * the strip.
 *
 * The panel's height is RESERVED with a min-height. Swapping content of
 * different heights is the most common source of layout shift on a marketing
 * page, and the budget here is CLS < 0.05. `mode="popLayout"` keeps the
 * outgoing panel out of flow while it leaves, so the two never stack.
 */

export interface Capability {
  key: string;
  label: string;
  headline: string;
  body: string;
  points: ReadonlyArray<{ text: string; claim: string }>;
  screen: ReactNode;
}

export function CapabilityTabs({ items }: { items: readonly Capability[] }) {
  const [active, setActive] = useState(0);
  const direction = useRef(1);
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reduced = usePrefersReducedMotion();

  const select = (next: number) => {
    direction.current = next > active ? 1 : -1;
    setActive(next);
  };

  const focusTab = (i: number) => {
    const next = (i + items.length) % items.length;
    select(next);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusTab(active + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusTab(active - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusTab(0);
        break;
      case 'End':
        e.preventDefault();
        focusTab(items.length - 1);
        break;
    }
  };

  const current = items[active];
  const enterX = reduced ? 0 : direction.current * 24;
  const exitX = reduced ? 0 : direction.current * -24;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Product capabilities"
        onKeyDown={onKeyDown}
        className="relative flex flex-wrap gap-1 rounded-xl border border-n-200 bg-card p-1 shadow-card"
      >
        {items.map((item, i) => (
          <button
            key={item.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${item.key}`}
            aria-selected={i === active}
            aria-controls={`${baseId}-panel-${item.key}`}
            // Roving tabindex: one stop for the whole strip, arrows move within.
            tabIndex={i === active ? 0 : -1}
            onClick={() => select(i)}
            className={cn(
              'relative flex-1 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors',
              i === active ? 'text-on-brand' : 'text-n-600 hover:text-n-900'
            )}
          >
            {i === active && (
              <motion.span
                layoutId={`${baseId}-pill`}
                aria-hidden="true"
                className="absolute inset-0 rounded-lg bg-brand-700"
                transition={
                  reduced
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 420, damping: 36 }
                }
              />
            )}
            {/* Above the pill, which is painted into the same box. */}
            <span className="relative z-10">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Reserved height — the tallest panel's, so a swap never moves the page. */}
      <div className="relative mt-6 min-h-[30rem] sm:min-h-[26rem] lg:min-h-[24rem]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={current.key}
            role="tabpanel"
            id={`${baseId}-panel-${current.key}`}
            aria-labelledby={`${baseId}-tab-${current.key}`}
            tabIndex={0}
            initial={reduced ? false : { opacity: 0, x: enterX }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? undefined : { opacity: 0, x: exitX }}
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.22, 0.61, 0.36, 1] }}
            className="grid gap-8 focus-visible:outline-none lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:items-center lg:gap-12"
          >
            <div>
              <h3 className="font-display text-2xl leading-tight font-bold text-balance text-n-900">
                {current.headline}
              </h3>
              <p className="mt-3 leading-7 text-pretty text-n-600">{current.body}</p>
              <ul className="mt-5 grid gap-2.5">
                {current.points.map((p) => (
                  <li
                    key={p.text}
                    data-claim={p.claim}
                    className="flex gap-2.5 text-[14.5px] leading-6 text-n-700"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="mt-1.5 h-3 w-3 shrink-0 text-brand-600"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 8.5 6.2 11.6 13 4.6" />
                    </svg>
                    <span>{p.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="min-w-0">{current.screen}</div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
