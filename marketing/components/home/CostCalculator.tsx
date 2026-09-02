'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

/**
 * §3 — the cost hook. "What is running payroll by hand costing you?"
 *
 * THE NUMBERS ARE THE READER'S, NOT OURS. Every input is theirs to set and the
 * defaults are labelled as a starting point rather than a benchmark. That
 * distinction is the whole reason this is allowed on a site that refuses to
 * publish figures it cannot source: a calculator that opens with "the average
 * business wastes 32% of payroll hours" is a fabricated statistic wearing a
 * form, and /methodology explicitly promises we do not do that. Arithmetic on
 * the reader's own inputs claims nothing.
 *
 * It also states what it does NOT model — this is a lower bound on effort, not
 * a saving we promise to deliver. Anyone senior enough to sign for payroll
 * software has seen the other kind of calculator and discounts it on sight.
 *
 * The collapsed→expanded morph is a `layout` animation, which is the one thing
 * a layout-animation library genuinely does better than CSS: the teaser and the
 * full form are different heights and different content, and springing between
 * two auto heights is not expressible in a transition.
 */

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

interface Field {
  key: 'employees' | 'minutes' | 'rate';
  label: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
  note: string;
}

const FIELDS: readonly Field[] = [
  {
    key: 'employees',
    label: 'People on payroll',
    suffix: '',
    min: 1,
    max: 2000,
    step: 1,
    note: 'headcount you run each month',
  },
  {
    key: 'minutes',
    label: 'Minutes per person, per month',
    suffix: 'min',
    min: 1,
    max: 180,
    step: 1,
    note: 'collecting attendance, keying it in, checking it, fixing it',
  },
  {
    key: 'rate',
    label: 'Cost of the person doing it',
    suffix: '₹/hour',
    min: 100,
    max: 5000,
    step: 50,
    note: 'fully loaded, not their salary divided by 160',
  },
];

const DEFAULTS = { employees: 50, minutes: 20, rate: 600 };

export function CostCalculator() {
  const reduced = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(DEFAULTS);

  const hoursPerMonth = (values.employees * values.minutes) / 60;
  const perMonth = hoursPerMonth * values.rate;
  const perYear = perMonth * 12;

  return (
    <motion.div
      layout={!reduced}
      transition={{ type: 'spring', stiffness: 220, damping: 28 }}
      className="rounded-2xl border border-n-200 bg-card p-6 shadow-card sm:p-7"
    >
      <motion.div layout={!reduced ? 'position' : false}>
        <p className="text-caption uppercase text-accent-700">Before you read any further</p>
        <h3 className="mt-3 font-display text-xl leading-tight font-bold text-balance text-n-900">
          What is running payroll by hand costing you?
        </h3>
      </motion.div>

      <AnimatePresence initial={false} mode="popLayout">
        {!open ? (
          <motion.div
            key="teaser"
            layout={!reduced}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? undefined : { opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-3"
          >
            <p className="text-[14.5px] leading-6 text-pretty text-n-600">
              Three numbers you already know — headcount, the minutes each one costs you every
              month, and what an hour of the person doing it is worth.
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-4 inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Work it out
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            layout={!reduced}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? undefined : { opacity: 0 }}
            transition={{ duration: 0.25, delay: reduced ? 0 : 0.05 }}
            className="mt-5"
          >
            <div className="grid gap-5">
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <label
                      htmlFor={`cost-${f.key}`}
                      className="text-[13.5px] font-semibold text-n-800"
                    >
                      {f.label}
                    </label>
                    <output
                      htmlFor={`cost-${f.key}`}
                      className="tnum text-[13.5px] font-bold text-brand-700"
                    >
                      {values[f.key].toLocaleString('en-IN')}
                      {f.suffix && <span className="ml-1 font-medium text-n-600">{f.suffix}</span>}
                    </output>
                  </div>
                  <input
                    id={`cost-${f.key}`}
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={values[f.key]}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.key]: Number(e.target.value) }))
                    }
                    className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-n-200 accent-brand-700"
                  />
                  <p className="mt-1.5 text-[11.5px] leading-4 text-n-600">{f.note}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl border border-brand-200 bg-brand-50 p-4">
              <p className="text-caption uppercase text-brand-700">Every year, on this alone</p>
              <p className="mt-1.5 font-display text-3xl font-bold text-brand-900">
                <AnimatedRupees value={perYear} reduced={reduced} />
              </p>
              <p className="mt-1.5 text-[12.5px] leading-5 text-brand-800/85">
                {RUPEES.format(perMonth)} a month · {hoursPerMonth.toFixed(1)} hours of somebody
                you already pay.
              </p>
            </div>

            <p className="mt-3 text-[11.5px] leading-4 text-n-600">
              Your numbers, your arithmetic. This counts the hours only — not a correction after
              the run, not a late filing, and not what those cost. It is a floor, not a promise.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * The result, counted rather than swapped.
 *
 * A figure that hard-cuts as a slider moves reads as a form field; one that
 * travels reads as a number being worked out. It animates from whatever was
 * last displayed, so dragging a slider produces one continuous movement instead
 * of a fight between overlapping animations.
 */
function AnimatedRupees({ value, reduced }: { value: number; reduced: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reduced) {
      node.textContent = RUPEES.format(value);
      shown.current = value;
      return;
    }

    const from = shown.current;
    const start = performance.now();
    const duration = 420;
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (value - from) * eased;
      node.textContent = RUPEES.format(current);
      shown.current = current;
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        node.textContent = RUPEES.format(value);
        shown.current = value;
      }
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);

  return (
    <span aria-label={RUPEES.format(value)}>
      {/* The accessible value lives on the wrapper; this span is decoration
          being mutated 60 times a second and must not be announced. */}
      <span ref={ref} className="tnum" aria-hidden="true">
        {RUPEES.format(value)}
      </span>
    </span>
  );
}
