import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import SectionHeading from './SectionHeading';
import { Reveal, Stagger, StaggerItem } from './Reveal';
import AnimatedPrice from './AnimatedPrice';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * §3 — the problem, and what it is costing.
 *
 * THE NUMBERS IN THE CALCULATOR ARE THE READER'S, NOT OURS. Every input is
 * theirs to set and the defaults are labelled as a starting point rather than a
 * benchmark. That distinction is the entire reason a calculator is allowed on a
 * site governed by PRODUCT_TRUTH.md: one that opens with "the average business
 * wastes 32% of payroll hours" is a fabricated statistic wearing a form — and
 * a 32% productivity claim is exactly what was deleted from the hero in Phase 1.
 * Arithmetic on the reader's own inputs claims nothing.
 *
 * It also states what it does NOT model. This is a lower bound on effort, not a
 * saving anyone promises to deliver. People senior enough to sign for payroll
 * software have seen the other kind of calculator and discount it on sight.
 *
 * The collapsed-to-expanded morph uses the `layout` prop, which is the one thing a
 * layout-animation library does genuinely better than CSS: the teaser and the
 * full form are different heights with different content, and springing between
 * two auto heights is not expressible as a transition.
 */

const WITHOUT: readonly string[] = [
  'A tracker from one vendor. An HRMS from another. Payroll from a third.',
  'Someone exports a CSV on the 25th and hopes the columns still line up.',
  'Attendance disputes are settled from memory, because the evidence is in a different tool.',
  'A salary component changes, and nobody can say later what it cost or who approved it.',
  'The statutory return disagrees with what was actually deducted — and you find out at filing.',
];

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

export default function ProblemCost() {
  const reduced = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(DEFAULTS);

  const hoursPerMonth = (values.employees * values.minutes) / 60;
  const perMonth = hoursPerMonth * values.rate;
  const perYear = perMonth * 12;

  return (
    <section className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="The actual problem"
          title="Your tracker doesn’t talk to your HRMS. Your HRMS doesn’t talk to your payroll."
          description="For most companies this size the real competitor isn’t a rival platform — it’s five disconnected tools and somebody holding them together by hand."
          align="left"
        />

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-12">
          <Stagger as="ul" className="grid gap-3">
            {WITHOUT.map((line) => (
              <StaggerItem
                key={line}
                as="li"
                className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400"
                  aria-hidden="true"
                />
                <span className="text-sm leading-6 text-slate-600">{line}</span>
              </StaggerItem>
            ))}
          </Stagger>

          <Reveal>
            <motion.div
              layout={!reduced}
              transition={{ type: 'spring', stiffness: 220, damping: 28 }}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <motion.div layout={!reduced ? 'position' : false}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                  Before you read any further
                </p>
                <h3 className="mt-3 text-lg font-bold leading-snug text-slate-900">
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
                    <p className="text-sm leading-6 text-slate-500">
                      Three numbers you already know — headcount, the minutes each one costs you
                      every month, and what an hour of the person doing it is worth.
                    </p>
                    <button
                      type="button"
                      onClick={() => setOpen(true)}
                      className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      Work it out
                      <ArrowRight className="h-4 w-4" />
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
                              className="text-[13px] font-semibold text-slate-700"
                            >
                              {f.label}
                            </label>
                            <output
                              htmlFor={`cost-${f.key}`}
                              className="text-[13px] font-bold tabular-nums text-blue-700"
                            >
                              {values[f.key].toLocaleString('en-IN')}
                              {f.suffix && (
                                <span className="ml-1 font-medium text-slate-500">{f.suffix}</span>
                              )}
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
                            className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-700"
                          />
                          <p className="mt-1.5 text-[11.5px] leading-4 text-slate-400">{f.note}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                        Every year, on this alone
                      </p>
                      <p className="mt-1.5 text-3xl font-bold text-blue-900">
                        <AnimatedPrice value={perYear} format={RUPEES.format} />
                      </p>
                      <p className="mt-1.5 text-[12.5px] leading-5 text-blue-800/85">
                        {RUPEES.format(perMonth)} a month · {hoursPerMonth.toFixed(1)} hours of
                        somebody you already pay.
                      </p>
                    </div>

                    <p className="mt-3 text-[11.5px] leading-4 text-slate-400">
                      Your numbers, your arithmetic. This counts the hours only — not a correction
                      after the run, not a late filing, and not what those cost. It is a floor, not
                      a promise.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/*
 * The counting figure used to live here as a local `AnimatedRupees`. It now
 * shares `AnimatedPrice` with the pricing table: two identical rAF count-ups
 * in one codebase is two places for the accessibility contract to drift apart,
 * and that contract has already been got wrong here once (an `aria-label` on a
 * bare span, which announces as nothing).
 */
