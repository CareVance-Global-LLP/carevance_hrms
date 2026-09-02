import { useRef } from 'react';
import StepArrows from './StepArrows';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { motion, useScroll, useTransform } from 'framer-motion';
import { DownloadCloud, ScanSearch, UserPlus } from 'lucide-react';
import { viewportOptions } from './animations';
import SectionNumber from './SectionNumber';

/**
 * THREE steps, not four.
 *
 * "Monitor in real time" and "Review, approve, and export" were separate
 * entries describing the same phase — the ongoing use of the product once it is
 * running — and splitting them made the migration look longer than it is, which
 * is precisely the objection this section exists to answer. They are merged.
 *
 * The order is also now the order a buyer actually experiences: the tracker
 * comes LAST. Payroll runs from attendance however it was created, so a
 * customer can be live on payroll before anyone installs anything, and putting
 * the desktop rollout at step two implied a dependency that does not exist.
 */
const steps = [
  {
    icon: UserPlus,
    title: 'Your people and your structure',
    description:
      'Import employees and salary structures by CSV, with government ID and bank-detail validation running as you go. Define components and the structure they hang off, or start from a template.',
  },
  {
    icon: ScanSearch,
    title: 'A parallel run against your current payroll',
    description:
      'Process a month without paying from it, then compare against your existing output. Every component that disagrees is listed with the reason it moved, and the override that caused it.',
  },
  {
    icon: DownloadCloud,
    title: 'Go live, with the tracker following',
    description:
      'Run payroll for real, generate the returns and the bank file. Roll the desktop tracker out afterwards — payroll works without it, and it makes attendance better once it is on.',
  },
];

function TimelineLine() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.7', 'start 0.2'],
  });
  const scrubbedScaleY = useTransform(scrollYProgress, [0, 1], [0, 1]);

  /*
   * The timeline spine fills as the reader descends; under reduced motion it is
   * drawn in full from the start.
   *
   * Bound through `style`, so the page's `MotionConfig reducedMotion="user"`
   * does not reach it. Left scrubbed it would stay at `scaleY: 0` — no spine at
   * all — since nothing advances a bound value when animations are off.
   */
  const reducedMotion = usePrefersReducedMotion();
  const scaleY = reducedMotion ? 1 : scrubbedScaleY;

  return (
    <div ref={ref} className="absolute left-6 top-0 bottom-0 hidden lg:block">
      <motion.div
        className="h-full w-0.5 origin-top bg-gradient-to-b from-blue-400 to-blue-600"
        style={{ scaleY }}
      />
    </div>
  );
}

export default function Workflow() {
  /*
   * `overflow-x-clip` below is load-bearing. Each step row enters from
   * `x: ±48`, so until it lands it sits up to 48px outside the viewport —
   * which at 390px was 32px of horizontal page scroll on every phone, on a
   * section most readers reach. Clipping contains the slide without changing
   * the animation.
   *
   * `clip` rather than `hidden`: `hidden` would make this a scroll container
   * and break `position: sticky` for anything a later edit nests inside.
   */
  return (
    <section
      id="workflow"
      className="overflow-x-clip bg-surface-sunken px-4 py-10 sm:px-6 sm:py-14 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <SectionNumber number={3} label="Workflow" className="mb-6" />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            How it works
          </span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
          >
            The objection is never the product. It is the migration.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl text-base leading-7 text-slate-500"
          >
            So here is the actual shape of it. The parallel run in step two is the part that matters
            — you should not have to trust a payroll engine you have not audited against your own
            numbers.
          </motion.p>
        </div>

        <div className="relative mt-14">
          <TimelineLine />
          {/* §7 — arrows drawn between the step cards. Decoration only: the
              steps are an ordered list and read as a sequence without it. */}
          <StepArrows count={steps.length} />

          <div className="space-y-8 lg:space-y-12">
            {steps.map((step, index) => {
              const isEven = index % 2 === 0;
              return (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, x: isEven ? -48 : 48 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={viewportOptions}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className={`relative flex items-start gap-6 lg:gap-12 ${isEven ? 'lg:flex-row' : 'lg:flex-row-reverse'}`}
                >
                  {/* Step number dot (visible on lg) */}
                  <div className="relative z-10 hidden lg:flex flex-shrink-0">
                    <motion.div
                      initial={{ scale: 0 }}
                      whileInView={{ scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ type: 'spring', stiffness: 500, damping: 25, delay: 0.2 }}
                      className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-200 bg-white text-sm font-bold text-blue-600 shadow-sm"
                    >
                      {index + 1}
                    </motion.div>
                  </div>

                  {/* Mobile step number */}
                  <div className="flex-shrink-0 lg:hidden">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white shadow-sm">
                      {index + 1}
                    </div>
                  </div>

                  {/* Card */}
                  <motion.div
                    whileHover={{ y: -4, boxShadow: '0 20px 60px -15px rgba(93, 150, 157, 0.2)' }}
                    transition={{ type: 'spring', stiffness: 350, damping: 20 }}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-6 py-6 shadow-sm"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                        <step.icon className="h-6 w-6" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">{step.title}</h3>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-500">{step.description}</p>
                  </motion.div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
