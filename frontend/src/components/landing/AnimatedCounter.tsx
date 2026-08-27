import { useEffect, useRef, useState } from 'react';
import { useInView } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

interface AnimatedCounterProps {
  target: number;
  suffix?: string;
  prefix?: string;
  /** Seconds. */
  duration?: number;
  className?: string;
}

/**
 * A number that counts up to a real figure.
 *
 * THE FINAL VALUE IS RENDERED FIRST, and the animation mutates it afterwards.
 * The previous version started a spring at 0 and derived the text from it,
 * which meant the DOM contained "0" until the element scrolled into view. That
 * fails three things at once:
 *
 *   · a crawler — and an AI answer engine — reads 0, not 37
 *   · a screen reader announces the blur rather than the value
 *   · under `prefers-reduced-motion` the number never animates, so with the old
 *     approach it would have sat at 0 permanently
 *
 * So the accessible name is the finished string, the visible span is
 * `aria-hidden` and mutated by rAF, and under reduced motion nothing is mutated
 * at all — the correct number is simply already there.
 *
 * Written against `requestAnimationFrame` rather than a spring so the value
 * lands exactly on the target rather than settling near it: "37 states" that
 * briefly reads 36 is worse than no animation.
 */
export default function AnimatedCounter({
  target,
  suffix = '',
  prefix = '',
  duration = 1.6,
  className,
}: AnimatedCounterProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const isInView = useInView(wrapRef, { once: true, amount: 0.5 });
  const reduced = usePrefersReducedMotion();
  const [final] = useState(() => `${prefix}${target.toLocaleString('en-IN')}${suffix}`);

  useEffect(() => {
    if (reduced || !isInView) return;
    const node = valueRef.current;
    if (!node) return;

    let raf = 0;
    let cancelled = false;
    const start = performance.now();
    const total = duration * 1000;

    const tick = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / total);
      // easeOutCubic — decelerates into the value rather than stopping dead.
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(target * eased);
      node.textContent = `${prefix}${current.toLocaleString('en-IN')}${suffix}`;
      if (t < 1) raf = requestAnimationFrame(tick);
      else node.textContent = final;
    };

    // Start from zero only now that we know the animation will actually run.
    node.textContent = `${prefix}0${suffix}`;
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      // Interrupted: land on the real number, never a partial count.
      node.textContent = final;
    };
  }, [isInView, reduced, target, prefix, suffix, duration, final]);

  return (
    <span ref={wrapRef} className={className}>
      {/*
        A VISUALLY-HIDDEN REAL TEXT NODE, not `aria-label` on this span.
        `aria-label` is only permitted on elements whose role supports naming; a
        bare <span> has role=generic, which prohibits it. Browsers and screen
        readers are entitled to ignore it — and since the animated span beside
        it is `aria-hidden`, the number would have been announced as NOTHING.
        Lighthouse flags this as "elements use prohibited ARIA attributes"; the
        sr-only text node is the pattern that actually works.
      */}
      <span className="sr-only">{final}</span>
      <span ref={valueRef} aria-hidden="true" className="tabular-nums">
        {final}
      </span>
    </span>
  );
}
