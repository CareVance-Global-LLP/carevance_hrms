'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/primitives';

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
 * The panel's height is RESERVED with a min-height. Swapping content of
 * different heights is the most common source of layout shift on a marketing
 * page, and the budget here is CLS < 0.05.
 *
 * The sliding pill is a measured transform rather than a shared-layout
 * animation from a library. Two refs and a transform do the same job, and this
 * component was one of the last things pulling an animation dependency into the
 * bundle — see the note in components/motion/Reveal.tsx.
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
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pillRef = useRef<HTMLSpanElement>(null);
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  /* Position the pill under the active tab. useLayoutEffect so it is correct on
     first paint rather than visibly jumping into place after it. */
  useLayoutEffect(() => {
    const tab = tabRefs.current[active];
    const pill = pillRef.current;
    if (!tab || !pill) return;

    const place = () => {
      pill.style.width = `${tab.offsetWidth}px`;
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    };

    place();

    // The strip wraps at narrow widths, so a resize moves every tab.
    const observer = new ResizeObserver(place);
    observer.observe(tab);
    if (tab.parentElement) observer.observe(tab.parentElement);
    return () => observer.disconnect();
  }, [active, items.length]);

  const focusTab = (i: number) => {
    const next = (i + items.length) % items.length;
    setActive(next);
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

  return (
    <div>
      <div
        role="tablist"
        aria-label="Product capabilities"
        onKeyDown={onKeyDown}
        className="relative flex flex-wrap gap-1 rounded-xl border border-n-200 bg-card p-1 shadow-card"
      >
        <span
          ref={pillRef}
          aria-hidden="true"
          className={cn(
            'absolute top-1 bottom-1 left-0 rounded-lg bg-brand-700',
            !reduced && 'transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]'
          )}
        />
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
            onClick={() => setActive(i)}
            className={cn(
              'relative z-10 flex-1 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors',
              i === active ? 'text-on-brand' : 'text-n-600 hover:text-n-900'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Reserved height — the tallest panel's, so a swap never moves the page. */}
      <div className="relative mt-6 min-h-[30rem] sm:min-h-[26rem] lg:min-h-[24rem]">
        <div
          // Keyed so React remounts on change, which restarts the entrance
          // animation. There is no exit animation, and none is wanted: a panel
          // that fades out before its replacement arrives reads as latency.
          key={current.key}
          role="tabpanel"
          id={`${baseId}-panel-${current.key}`}
          aria-labelledby={`${baseId}-tab-${current.key}`}
          tabIndex={0}
          className="panel-in grid gap-8 focus-visible:outline-none lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:items-center lg:gap-12"
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
        </div>
      </div>
    </div>
  );
}
