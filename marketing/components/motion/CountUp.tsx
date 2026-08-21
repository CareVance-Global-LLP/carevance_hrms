'use client';

import { useEffect, useRef } from 'react';

/**
 * Motion 3 — Count-up. For real numbers only (see lib/facts.ts).
 *
 * THE FINAL VALUE IS IN THE SERVER-RENDERED HTML. First paint is the finished
 * string; the animation, if it runs at all, mutates textContent afterwards. That
 * ordering is three requirements at once:
 *
 *   · a crawler (and an AI answer engine) reads the real number, not "0"
 *   · a screen reader announces the final value via aria-label, never the blur
 *   · there is no layout shift, because the widest string was always rendered
 *
 * Starting at 0 and counting up in React state — what almost every marketing
 * site ships — fails all three.
 *
 * Written against requestAnimationFrame rather than motion/react so that a
 * count-up in the page header does not drag an animation library into the
 * critical bundle. See the note in Reveal.tsx.
 */

interface CountUpProps {
  /** The pre-formatted final string, e.g. "37" or "₹15,000". Rendered as-is. */
  value: string;
  /** The number to animate toward. Omit to render `value` with no animation. */
  n?: number;
  className?: string;
  /** Provenance, surfaced as a tooltip. */
  title?: string;
}

const DURATION = 1200;

/**
 * Rebuilds the display string at an intermediate value, preserving whatever
 * decoration `value` carries — currency symbol, Indian grouping, decimals.
 * Formatting is derived from the target rather than re-specified, so
 * "₹20,00,000" counts up in Indian grouping and "1.668" keeps three decimals.
 */
function makeFormatter(value: string) {
  const decimals = (value.split('.')[1] ?? '').replace(/\D+$/, '').length;
  const prefix = value.match(/^[^\d-]*/)?.[0] ?? '';
  const suffix = (value.match(/[^\d]*$/)?.[0] ?? '').replace(/[,.]/g, '');
  const grouped = value.includes(',');

  const fmt = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (current: number) => {
    const body = grouped ? fmt.format(current) : current.toFixed(decimals);
    return `${prefix}${body}${suffix}`;
  };
}

export function CountUp({ value, n, className, title }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (n === undefined) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    let raf = 0;
    let cancelled = false;

    const run = () => {
      const format = makeFormatter(value);
      const start = performance.now();

      const tick = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - start) / DURATION);
        // easeOutCubic — decelerates into the final value rather than stopping dead.
        const eased = 1 - Math.pow(1 - t, 3);
        node.textContent = format(n * eased);

        if (t < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          // Land on the authored string exactly, never on the formatter's guess.
          node.textContent = value;
        }
      };

      raf = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          run();
        }
      },
      { threshold: 0.6 }
    );

    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [n, value]);

  return (
    <span className={className} title={title} aria-label={value}>
      <span ref={ref} className="tnum" aria-hidden="true">
        {value}
      </span>
    </span>
  );
}
