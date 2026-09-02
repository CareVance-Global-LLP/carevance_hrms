import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from 'framer-motion';
import SectionHeading from './SectionHeading';
import { easeOut } from './animations';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import {
  TrackerCapture,
  AttendanceMonth,
  RunAndDifferences,
  Payslip,
} from './ProductScreens';

/**
 * §4 — the scroll-linked product tour. Track → Attend → Approve → Pay.
 *
 * A sticky frame on the left holds one real screenshot at a time; four step
 * blocks scroll past on the right and decide which one that is. The reader
 * controls the pace, which is the whole advantage over a product video: nobody
 * can pause a video on the frame they did not understand and read the note
 * beside it.
 *
 * FOUR THINGS ARE LOAD-BEARING.
 *
 * 1. THE STEP INDEX IS FLOORED, NOT ROUNDED. Rounding a 0→1 progress mapped
 *    onto [0,1,2,3] switches the frame at the MIDDLE of each block — the
 *    screenshot changes while the reader is still on the paragraph describing
 *    the previous one. Flooring switches exactly at the boundary between
 *    blocks, which is where the reader's eye already is.
 *
 * 2. THE MOBILE FALLBACK IS NOT THIS. Below `lg` the sticky column is dropped
 *    entirely and each step renders its own screenshot inline, as a plain
 *    stacked list. Pinning a section on a phone fights the browser's own
 *    address-bar collapse, and it is where scrollytelling reliably turns to
 *    jank on a mid-range Android.
 *
 * 3. EVERY STEP'S TEXT IS IN THE DOM AT ALL TIMES and only the imagery swaps.
 *    A crawler, an answer engine and a reader whose JS failed all get the
 *    complete argument; the choreography is enhancement on top of it.
 *
 * 4. THE MARKERS CARRY NO LABEL. An earlier version put the caption on the
 *    screenshot beside its dot and it covered the exact row it pointed at. The
 *    marker is a number; the sentence lives in the numbered list beside the
 *    frame, where there is room for it and where a screen reader reaches it as
 *    text. â‘¡ on the screen is â‘¡ in the list — how every annotated diagram in
 *    print has worked for a century.
 */

interface Callout {
  /** Percentage across / down the frame. Centre of the marker. */
  x: number;
  y: number;
  text: string;
}

interface Step {
  key: string;
  label: string;
  claim: string;
  title: string;
  body: string;
  /**
   * The screen, rebuilt in markup — NOT a PNG.
   *
   * This was `image: string` pointing at real captures from a demo tenant, and
   * they showed an empty system: 0h 0m tracked, "No tool analytics found",
   * Total Payroll ₹0, every statutory filing marked "Needs run". Each sat
   * beneath a caption claiming the opposite, so the strongest section on the
   * page was arguing against itself. They were also 2880px-wide full-page
   * captures squeezed into a card, i.e. illegible even when they were right.
   */
  screen: ReactNode;
  callouts: readonly Callout[];
}

const STEPS: readonly Step[] = [
  {
    key: 'track',
    label: 'Track',
    claim: 'TIM-01',
    title: 'The work is captured as it happens.',
    body: 'A desktop tracker takes screenshots and reads OS-level idle; the browser extension adds URL context. When the network drops, captures queue to disk rather than evaporating.',
    screen: <TrackerCapture />,
    callouts: [
      { x: 0, y: 55, text: 'Every capture is taken only while consent is active' },
      { x: 0, y: 82, text: 'Idle rewinds to the last real activity — recorded, never billed' },
    ],
  },
  {
    key: 'attend',
    label: 'Attend',
    claim: 'TIM-09',
    title: 'Activity resolves into attendance.',
    body: 'Sessions are classified, then resolved against the employee’s shift, timezone and overtime rules into an attendance month with hours, LOP and regularisations — the record payroll will read.',
    screen: <AttendanceMonth />,
    callouts: [
      { x: 0, y: 42, text: 'The shift this month was measured against' },
      { x: 0, y: 78, text: 'One regularisation, approved and folded into the month' },
    ],
  },
  {
    key: 'approve',
    label: 'Approve',
    claim: 'CTL-01',
    title: 'The mistake is found before the money moves.',
    body: 'A run walks draft → locked → approved → released → disbursed, each stage stamped with who did it and when. The differences report names the override that moved each component, so nothing changes anonymously.',
    screen: <RunAndDifferences />,
    callouts: [
      { x: 0, y: 22, text: 'Five stages — the run is on the last one, not yet disbursed' },
      { x: 0, y: 68, text: 'Every component that moved, with the override that moved it' },
    ],
  },
  {
    key: 'pay',
    label: 'Pay',
    claim: 'BNK-03',
    title: 'And the same record becomes the payslip.',
    body: 'Statutory deductions compute from the run, a NEFT/RTGS file pays it, and every line is recorded. The bank’s returned UTR is the only reference a statement reconciles against — never one invented locally.',
    screen: <Payslip />,
    callouts: [
      { x: 0, y: 48, text: 'PF, ESI, PT and TDS, computed from the attendance above' },
      /*
       * This replaced "Unpayable people are excluded by name, never silently
       * dropped" — a true statement about disbursement that pointed at nothing
       * on a single payslip. A marker has to indicate something the reader can
       * actually see, or it teaches them the markers are decoration.
       */
      { x: 0, y: 82, text: 'ESI is nil because gross clears the ₹21,000 threshold' },
    ],
  },
];

export default function ProductTour() {
  const reduced = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLOListElement>(null);
  const [step, setStep] = useState(0);

  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start start', 'end end'],
  });

  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    if (reduced) return;
    setStep(Math.min(STEPS.length - 1, Math.max(0, Math.floor(p * STEPS.length))));
  });

  const railScale = useTransform(scrollYProgress, (p) => Math.max(0.02, p));

  useLenisWhileInView(sectionRef, !reduced);

  const current = STEPS[step] ?? STEPS[0];

  return (
    <section ref={sectionRef} className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="One record, four steps"
          title="Follow one tracked minute all the way to a paid payslip."
          align="left"
        />

        <div className="mt-14 lg:grid lg:grid-cols-[1.5rem_minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-x-10">
          {/* ── The rail ────────────────────────────────────────────── */}
          <div className="hidden lg:block" aria-hidden="true">
            <div className="sticky top-1/2 flex -translate-y-1/2 justify-center">
              {/* The dots sit ON the line. A detached column of dots beside a
                  separate bar reads as two indicators disagreeing. */}
              <div className="relative h-44 w-px bg-slate-200">
                <motion.div
                  className="absolute inset-x-0 top-0 h-full origin-top bg-blue-600"
                  style={reduced ? { scaleY: 1 } : { scaleY: railScale }}
                />
                {STEPS.map((s, i) => (
                  <span
                    key={s.key}
                    style={{ top: `${(i / (STEPS.length - 1)) * 100}%` }}
                    className={`absolute left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition-colors duration-300 ${
                      i <= step ? 'bg-blue-600' : 'bg-slate-300'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* ── The sticky frame ────────────────────────────────────── */}
          <div className="hidden lg:block">
            <div className="sticky top-24 flex min-h-[calc(100vh-11rem)] items-center">
              <div className="relative w-full">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={current.key}
                    initial={reduced ? false : { opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduced ? undefined : { opacity: 0, scale: 0.985 }}
                    transition={{ duration: 0.4, ease: easeOut }}
                  >
                    {/* The screen brings its own frame — see ProductScreens. */}
                    {current.screen}
                  </motion.div>
                </AnimatePresence>

                <AnimatePresence initial={false}>
                  {current.callouts.map((c, i) => (
                    <Marker
                      key={`${current.key}-${c.text}`}
                      callout={c}
                      index={i}
                      delay={0.3 + i * 0.12}
                      reduced={reduced}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* ── The steps ───────────────────────────────────────────── */}
          {/* `relative` is required, not cosmetic: framer-motion measures a
              useScroll target against its offset parent, and a `static` element
              makes every offset it reports wrong. It warns about this at
              runtime — the step index would drift from the scroll position. */}
          <ol ref={trackRef} className="relative grid gap-12 lg:block">
            {STEPS.map((s, i) => (
              <li
                key={s.key}
                data-claim={s.claim}
                className="flex flex-col justify-center lg:min-h-screen"
              >
                <div
                  className={`transition-opacity duration-500 ${
                    !reduced && i !== step ? 'lg:opacity-40' : 'lg:opacity-100'
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                    Step {i + 1} · {s.label}
                  </p>
                  <h3 className="mt-3 text-xl font-bold leading-tight text-slate-900">
                    {s.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-500">{s.body}</p>

                  {/* The legend the markers point at. Numbers, not bullets. */}
                  <ol className="mt-4 grid gap-2">
                    {s.callouts.map((c, ci) => (
                      <li key={c.text} className="flex gap-2.5 text-[13px] leading-6 text-slate-600">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold tabular-nums text-blue-800">
                          {ci + 1}
                        </span>
                        <span>{c.text}</span>
                      </li>
                    ))}
                  </ol>

                  {/* Mobile fallback: the screen, inline, nothing pinned. */}
                  <div className="mt-6 lg:hidden">{s.screen}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/*
 * `BrowserChrome` used to live here, wrapping the PNG screenshots. The screens
 * from ProductScreens.tsx bring their own frame, so it went with them.
 */

/**
 * A numbered marker over the frame.
 *
 * The pulse is a SEPARATE absolutely-positioned ring rather than an animation
 * on the marker itself: scaling the marker would scale its digit too, and a
 * number that breathes is a number nobody can read.
 */
function Marker({
  callout,
  index,
  delay,
  reduced,
}: {
  callout: Callout;
  index: number;
  delay: number;
  reduced: boolean;
}) {
  return (
    <motion.div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${callout.x}%`, top: `${callout.y}%` }}
      initial={reduced ? false : { opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? undefined : { opacity: 0 }}
      transition={{ duration: 0.35, delay: reduced ? 0 : delay, ease: easeOut }}
    >
      <span className="relative flex h-5 w-5">
        {!reduced && (
          <motion.span
            className="absolute inset-0 rounded-full bg-blue-500"
            animate={{ scale: [1, 2], opacity: [0.5, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-blue-700 text-[11px] font-bold tabular-nums text-white ring-2 ring-white">
          {index + 1}
        </span>
      </span>
    </motion.div>
  );
}

/**
 * Lenis smooth scroll, alive only while this section is on screen.
 *
 * It is NOT site-wide. Taking over scroll for a whole visit costs more than it
 * returns — it desynchronises the scrollbar thumb, fights trackpad momentum,
 * and makes find-in-page jump. What it genuinely buys is a scrubbed section,
 * where the reader is dragging a timeline rather than reading, and native
 * scroll's per-event granularity shows up as stepping.
 *
 * The generous `rootMargin` is what makes the handover invisible: Lenis is
 * already running well before the section's first pixel arrives. Creating it
 * exactly at the boundary is what would produce a visible lurch.
 */
function useLenisWhileInView(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    let raf = 0;
    let cancelled = false;

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      lenis?.destroy();
      lenis = null;
    };

    const start = async () => {
      if (lenis || cancelled) return;
      // Dynamic import: ~10 KB needed by exactly one section on one route, so
      // it must never sit in the initial bundle.
      const { default: Lenis } = await import('lenis');
      if (cancelled) return;
      lenis = new Lenis({ lerp: 0.14, wheelMultiplier: 1 });
      const tick = (time: number) => {
        lenis?.raf(time);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void start();
        else stop();
      },
      { rootMargin: '60% 0px 60% 0px' }
    );

    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
      stop();
    };
  }, [ref, enabled]);
}
