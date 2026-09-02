'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/components/ui/primitives';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';
import type { BillingCycle } from '@/lib/pricing';

/**
 * §12 — the monthly/yearly switch above the pricing preview.
 *
 * AND THE HONEST PART, WHICH IS THE WHOLE REASON THIS FILE HAS A COMMENT.
 *
 * Yearly billing discounts the PER-SEAT tracking plans (₹399 → ₹359, ₹599 →
 * ₹539) and does not discount the workspace payroll plans at all —
 * `monthlyTotal()` takes the `basePrice` branch for those and never looks at
 * the cycle. That is the real commercial position, so the toggle reports it:
 * cards with no annual price say "same either way" rather than silently showing
 * an unchanged number beside a control that implies a saving.
 *
 * The alternative — a toggle that appears to do nothing on two of three cards —
 * is the version a reader assumes is broken, and the version that gets found
 * out at checkout. Naming it costs one line and buys the section its
 * credibility back.
 *
 * The pill is a `layoutId` shared transition, the same mechanism as the
 * capability tabs, so the two controls on this page move the same way.
 */

const CYCLES: ReadonlyArray<{ value: BillingCycle; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export function BillingToggle({
  cycle,
  onChange,
  savingLabel,
}: {
  cycle: BillingCycle;
  onChange: (c: BillingCycle) => void;
  savingLabel: string;
}) {
  const reduced = usePrefersReducedMotion();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Billing cycle"
        className="relative inline-flex rounded-lg border border-n-200 bg-card p-1 shadow-card"
      >
        {CYCLES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={cycle === c.value}
            onClick={() => onChange(c.value)}
            className={cn(
              'relative rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
              cycle === c.value ? 'text-on-brand' : 'text-n-600 hover:text-n-900'
            )}
          >
            {cycle === c.value && (
              <motion.span
                layoutId="billing-pill"
                aria-hidden="true"
                className="absolute inset-0 rounded-md bg-brand-700"
                transition={
                  reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }
                }
              />
            )}
            <span className="relative z-10">{c.label}</span>
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-n-600">{savingLabel}</p>
    </div>
  );
}

/**
 * A price that travels to its new value instead of cutting to it.
 *
 * Cross-fading two strings is what the brief asks to avoid, and for good
 * reason: a number that blinks reads as a page re-render, whereas a number that
 * counts reads as the same number being recalculated — which is what actually
 * happened.
 *
 * The FULL STRING is the accessible name and is what a crawler reads; only the
 * inner span is mutated. Identical contract to CountUp, and for the same three
 * reasons stated there.
 */
export function AnimatedPrice({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reduced) {
      node.textContent = format(value);
      shown.current = value;
      return;
    }

    const from = shown.current;
    if (from === value) {
      node.textContent = format(value);
      return;
    }

    const start = performance.now();
    const duration = 420;
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (value - from) * eased;
      node.textContent = format(current);
      shown.current = current;
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        node.textContent = format(value);
        shown.current = value;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, format, reduced]);

  return (
    <span className={className} aria-label={format(value)}>
      <span ref={ref} className="tnum" aria-hidden="true">
        {format(value)}
      </span>
    </span>
  );
}
