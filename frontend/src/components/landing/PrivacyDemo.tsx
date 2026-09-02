import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Lock } from 'lucide-react';
import SectionHeading from './SectionHeading';
import { Stagger, StaggerItem } from './Reveal';
import { CaptureGallery } from './ProductScreens';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * §8 — privacy, demonstrated rather than asserted.
 *
 * Time Doctor's page says "privacy-first". So does everyone's. The sentence
 * costs nothing to write and is therefore worth nothing to read, which is why
 * this section spends its budget on a two-second demonstration instead: the
 * capture on screen goes out of focus as the reader scrolls, and a lock takes
 * its place. Whatever else they forget, they remember that the screenshot
 * disappeared.
 *
 * The blur is SCRUBBED rather than triggered, because the point is the
 * THRESHOLD — the reader sees the capture legible, then not, and the crossing
 * is the argument. A single triggered transition would just look like a load
 * state.
 *
 * `filter` is the one property here that is not transform or opacity, and it is
 * a deliberate exception: blur is compositor-accelerated in every browser this
 * app supports, and there is no way to express "this became unreadable" in the
 * two cheap properties. It runs on ONE element, in one section, below the fold.
 *
 * Under `prefers-reduced-motion` the card renders in its blurred end state with
 * the lock already shown. The demonstration survives; only the scrub is gone.
 */

const POINTS = [
  {
    title: 'One gate, every capture path',
    body: 'Screenshots, activity, URLs and location all pass the same consent check. There is no path that captures first and asks later.',
    claim: 'CON-01',
  },
  {
    title: 'Notices are versioned, never edited',
    body: 'What somebody agreed to is the text they were shown. Editing a notice in place would rewrite consent already given.',
    claim: 'CON-02',
  },
  {
    title: 'Consent is per capture type, and withdrawable',
    body: 'Agreeing to activity tracking is not agreeing to screenshots. Withdrawal takes effect on the next capture attempt, which is refused.',
    claim: 'CON-03',
  },
  {
    title: 'Screenshots are purged on a retention schedule',
    body: 'Kept for as long as they are useful and no longer. Built this way because under the DPDP Act the liability sits with the employer, not the vendor.',
    claim: 'CON-05',
  },
] as const;

export default function PrivacyDemo() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.75', 'end 0.65'],
  });

  const filter = useTransform(scrollYProgress, [0.25, 0.65], ['blur(0px)', 'blur(9px)']);
  const captureOpacity = useTransform(scrollYProgress, [0.25, 0.65], [1, 0.55]);
  const lockOpacity = useTransform(scrollYProgress, [0.35, 0.7], [0, 1]);
  const lockScale = useTransform(scrollYProgress, [0.35, 0.7], [0.9, 1]);

  return (
    <section className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="Monitoring people can live with"
          title="The tracker asks first, and stops looking when told."
          description="Consent is a gate every capture path passes through, not a checkbox in a settings page. An employee who withdraws it is not captured — the code path ends, rather than capturing and hiding."
          align="left"
        />

        <div
          ref={ref}
          // `relative` — a useScroll target must not be `static`, or the blur
          // scrub is driven by offsets measured against the wrong parent.
          className="relative mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-12"
        >
          {/* ── The demonstration ────────────────────────────────── */}
          <div className="relative">
            <motion.div
              style={
                reduced ? { filter: 'blur(9px)', opacity: 0.55 } : { filter, opacity: captureOpacity }
              }
              className="will-change-[filter]"
            >
              {/*
                A capture gallery, rebuilt in markup — not the monitoring PNG
                that used to sit here. That screenshot showed an empty tenant
                (0.0% productive share, "No tool analytics found"), which is a
                poor thing to blur out: the demonstration only lands if there
                was visibly something to stop capturing.

                The frames inside it are deliberately abstract rather than
                depictions of somebody's screen. Inventing the contents of a
                captured window, on the section arguing that captures are
                consent-gated and purged, would be the exact opposite of the
                point being made.
              */}
              <CaptureGallery />
            </motion.div>

            <motion.div
              style={reduced ? { opacity: 1 } : { opacity: lockOpacity, scale: lockScale }}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="flex max-w-[17rem] flex-col items-center rounded-xl border border-slate-200 bg-white px-5 py-4 text-center shadow-xl">
                <Lock className="h-5 w-5 text-blue-700" strokeWidth={1.9} />
                <p className="mt-2.5 text-[13.5px] font-semibold leading-5 text-slate-900">
                  Consent withdrawn — capture stops
                </p>
                <p className="mt-1 text-[12px] leading-4 text-slate-500">
                  Not captured and hidden. Not captured at all.
                </p>
              </div>
            </motion.div>
          </div>

          {/* ── The rules behind it ──────────────────────────────── */}
          <Stagger as="ul" className="grid gap-4">
            {POINTS.map((p) => (
              <StaggerItem
                key={p.title}
                as="li"
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div data-claim={p.claim}>
                  <p className="text-sm font-semibold text-slate-900">{p.title}</p>
                  <p className="mt-1 text-[13px] leading-5 text-slate-500">{p.body}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </div>
    </section>
  );
}
