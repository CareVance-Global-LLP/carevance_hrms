'use client';

import { motion } from 'motion/react';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

/**
 * §2 — what changes on day one.
 *
 * Placed directly under the hero on purpose. The research put this section
 * exactly here on the page that converts best in the category, and the reason
 * is structural rather than stylistic: a buyer arriving from a search for
 * "payroll software India" has a problem, not a curiosity. Four sentences that
 * name their Tuesday afternoon earn the scroll that the product tour then
 * spends.
 *
 * THE MOTION HERE IS DELIBERATELY THIN. One staggered rise, and a single
 * scale pulse on each icon as its card lands. That is the whole budget: this
 * section's power is in the copy, and animation on a pain-removal card competes
 * with the sentence rather than serving it. Everything expensive on this page
 * happens further down, once the reader has agreed to keep going.
 *
 * Each card names the mechanism, not a benefit — "the return agrees with what
 * you deducted" is checkable, "compliance, simplified" is not. Every one
 * carries the claim ID it was audited under.
 */

const EASE = [0.22, 0.61, 0.36, 1] as const;

interface Change {
  claim: string;
  before: string;
  title: string;
  body: string;
  icon: 'link' | 'evidence' | 'audit' | 'balance';
}

const CHANGES: readonly Change[] = [
  {
    claim: 'TIM-09',
    before: 'Today: someone exports a CSV on the 25th.',
    title: 'Attendance reaches payroll without a spreadsheet in between',
    body: 'The run reads the attendance record directly, through one endpoint you can inspect before you trust it. There is no export step to get wrong, and no month where the columns quietly moved.',
    icon: 'link',
  },
  {
    claim: 'TIM-04',
    before: 'Today: disputes are settled from memory.',
    title: 'An hour in dispute has its evidence attached',
    body: 'The screenshot, the activity classification and the hour they produced are one record. Idle time is rewound to the last real activity — recorded so you can see it, never billed as though it were work.',
    icon: 'evidence',
  },
  {
    claim: 'OVR-02',
    before: 'Today: nobody can say what a change cost.',
    title: 'Every salary change names its cost and its approver',
    body: 'The applied value sits beside the value the engine would have produced, and the difference is attributed to the override that caused it — proposed by one person, approved by another, on an append-only trail.',
    icon: 'audit',
  },
  {
    claim: 'STA-03',
    before: 'Today: you find out at filing.',
    title: 'The statutory return agrees with what you actually deducted',
    body: 'ESI coverage stays locked for the whole contribution period rather than being tested month by month. That single rule is the most common reason a return and a payslip disagree, and it is applied before the money moves.',
    icon: 'balance',
  },
];

export function DayOne() {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="py-16 sm:py-20 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-caption uppercase text-brand-700">What changes on day one</p>
          <h2 className="mt-3 font-display text-title text-balance text-n-900">
            Four things stop being your problem.
          </h2>
        </div>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {CHANGES.map((c, i) => (
            <motion.li
              key={c.claim}
              data-claim={c.claim}
              initial={reduced ? false : { opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.5, delay: reduced ? 0 : i * 0.07, ease: EASE }}
              className="rounded-xl border border-n-200 bg-card p-6 shadow-card"
            >
              <motion.span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700"
                initial={reduced ? false : { scale: 1 }}
                whileInView={reduced ? undefined : { scale: [1, 1.15, 1] }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.45, delay: reduced ? 0 : i * 0.07 + 0.2, ease: EASE }}
              >
                <Icon kind={c.icon} />
              </motion.span>

              <p className="mt-4 text-[12px] leading-4 font-medium text-n-500">{c.before}</p>
              <h3 className="mt-1.5 font-display text-[17px] leading-snug font-bold text-balance text-n-900">
                {c.title}
              </h3>
              <p className="mt-2 text-[14px] leading-6 text-pretty text-n-600">{c.body}</p>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Four line icons, inline. A dependency for eight paths would be absurd. */
function Icon({ kind }: { kind: Change['icon'] }) {
  const common = {
    viewBox: '0 0 24 24',
    className: 'h-5 w-5',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (kind) {
    case 'link':
      return (
        <svg {...common}>
          <path d="M10 13.5a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
          <path d="M14 10.5a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5" />
        </svg>
      );
    case 'evidence':
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
          <path d="M8 20h8M12 16.5V20" />
          <circle cx="12" cy="10.5" r="2.5" />
        </svg>
      );
    case 'audit':
      return (
        <svg {...common}>
          <path d="M6 3.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5Z" />
          <path d="M13.5 3.5V8h4.5M8.5 13l2 2 4-4" />
        </svg>
      );
    case 'balance':
      return (
        <svg {...common}>
          <path d="M12 4v16M5 8h14" />
          <path d="M5 8 2.5 14a2.8 2.8 0 0 0 5 0Z" />
          <path d="M19 8l-2.5 6a2.8 2.8 0 0 0 5 0Z" />
        </svg>
      );
  }
}
