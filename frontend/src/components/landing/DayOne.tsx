import { Link2, Camera, FileSearch, Scale } from 'lucide-react';
import { motion } from 'framer-motion';
import SectionHeading from './SectionHeading';
import { Stagger, StaggerItem } from './Reveal';
import { easeOut } from './animations';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * §2 — what changes on day one.
 *
 * Sits directly under the hero on purpose. The research put this section
 * exactly here on the page that converts best in the category, and the reason
 * is structural rather than stylistic: somebody arriving from a search for
 * "payroll software India" has a problem, not a curiosity. Four sentences that
 * name their Tuesday afternoon earn the scroll that the product tour then
 * spends.
 *
 * THE MOTION HERE IS DELIBERATELY THIN — one stagger, and a single scale pulse
 * on each icon as its card lands. That is the whole budget. This section's
 * power is in the copy, and animation on a pain-removal card competes with the
 * sentence rather than serving it; everything expensive on this page happens
 * further down, once the reader has agreed to keep going.
 *
 * Each card names a MECHANISM, not a benefit. "The return agrees with what you
 * deducted" is checkable; "compliance, simplified" is not. Every one carries
 * the PRODUCT_TRUTH.md claim ID it was audited under, in `data-claim`, so the
 * page can be grepped for unsourced assertions.
 */

interface Change {
  claim: string;
  before: string;
  title: string;
  body: string;
  icon: typeof Link2;
}

const CHANGES: readonly Change[] = [
  {
    claim: 'TIM-09',
    before: 'Today: someone exports a CSV on the 25th.',
    title: 'Attendance reaches payroll without a spreadsheet in between',
    body: 'The run reads the attendance record directly, through one endpoint you can inspect before you trust it. There is no export step to get wrong, and no month where the columns quietly moved.',
    icon: Link2,
  },
  {
    claim: 'TIM-04',
    before: 'Today: disputes are settled from memory.',
    title: 'An hour in dispute has its evidence attached',
    body: 'The screenshot, the activity classification and the hour they produced are one record. Idle time is rewound to the last real activity — recorded so you can see it, never billed as though it were work.',
    icon: Camera,
  },
  {
    claim: 'OVR-02',
    before: 'Today: nobody can say what a change cost.',
    title: 'Every salary change names its cost and its approver',
    body: 'The applied value sits beside the value the engine would have produced, and the difference is attributed to the override that caused it — proposed by one person, approved by another, on an append-only trail.',
    icon: FileSearch,
  },
  {
    claim: 'STA-03',
    before: 'Today: you find out at filing.',
    title: 'The statutory return agrees with what you actually deducted',
    body: 'ESI coverage stays locked for the whole contribution period rather than being tested month by month. That single rule is the most common reason a return and a payslip disagree, and it is applied before the money moves.',
    icon: Scale,
  },
];

export default function DayOne() {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="What changes on day one"
          title="Four things stop being your problem."
          align="left"
        />

        <Stagger as="ul" className="mt-12 grid gap-5 sm:grid-cols-2">
          {CHANGES.map((c, i) => (
            <StaggerItem
              key={c.claim}
              as="li"
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div data-claim={c.claim}>
                <motion.span
                  aria-hidden="true"
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"
                  initial={reduced ? false : { scale: 1 }}
                  whileInView={reduced ? undefined : { scale: [1, 1.15, 1] }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.45, delay: reduced ? 0 : i * 0.07 + 0.2, ease: easeOut }}
                >
                  <c.icon className="h-5 w-5" strokeWidth={1.8} />
                </motion.span>

                <p className="mt-4 text-xs font-medium text-slate-400">{c.before}</p>
                <h3 className="mt-1.5 text-base font-bold leading-snug text-slate-900">
                  {c.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{c.body}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
