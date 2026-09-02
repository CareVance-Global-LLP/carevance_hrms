import { useEffect, useRef, useState } from 'react';
import { useInView, useMotionValueEvent, useScroll } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

import { BRAND } from '@/config/brand';
/**
 * §6 — the statutory section, and the most load-bearing proof on the page.
 *
 * Every payroll vendor in India says "statutory compliance, handled". The claim
 * is unfalsifiable at the marketing layer, so buyers have learned to discount
 * it. What cannot be discounted is the file itself: eleven `||`-delimited
 * fields in EPFO's column order, with a legend saying where each number came
 * from. A competitor generating its returns in a spreadsheet cannot put this on
 * a landing page, which is exactly why it belongs on ours.
 *
 * THE BYTES ARE NOT PROP COPY. The format is `PayrollFilingService::
 * generatePfEcr()` in the backend — eleven fields joined with `||`, in that
 * order. The values are one worked example that balances: basic ₹48,000 caps to
 * the ₹15,000 PF wage ceiling, 12% of which is ₹1,800, which splits 8.33/3.67
 * into ₹1,249.50 of pension and ₹550.50 of provident fund. The line is
 * ASSEMBLED from ECR_FIELDS below rather than typed out, so the bytes and the
 * legend beside them cannot disagree.
 *
 * TYPING, AND WHY THE TEXT IS IN THE DOM ANYWAY. The finished line is rendered
 * first and `useLayoutEffect` clears it before the browser paints — never
 * `useEffect`, which would paint the full line and then visibly retype it. If
 * the effect never runs, the reader keeps the bytes. Fail visible.
 */

/** Format-valid demo UAN. Deliberately not a real one. */
const DEMO_UAN = '101234567890';

const ECR_FIELDS = [
  { label: 'UAN', value: DEMO_UAN, note: 'column 1 — mandatory, or EPFO rejects the file' },
  { label: 'Member name', value: 'Priya Nair', note: 'as held on the member record' },
  { label: 'Gross wages', value: '115891.20', note: 'the payslip’s gross, unchanged' },
  { label: 'EPF wages', value: '15000.00', note: 'basic, capped at the ₹15,000 ceiling' },
  { label: 'EPS wages', value: '15000.00', note: 'the same capped wage' },
  { label: 'EDLI wages', value: '15000.00', note: 'the same capped wage' },
  { label: 'EPF contribution (EE)', value: '1800.00', note: '12% of the capped wage' },
  { label: 'EPS contribution (ER)', value: '1249.50', note: '8.33% — the pension half' },
  { label: 'EPF contribution (ER)', value: '550.50', note: '3.67% — the balance of the 12%' },
  { label: 'NCP days', value: '0.00', note: 'non-contributory period — same basis as wages' },
  { label: 'Refund of advances', value: '0.00', note: 'nil' },
] as const;

const ECR_LINE = ECR_FIELDS.map((f) => f.value).join('||');
const ECR_FILENAME = `pf_ecr_${BRAND.enabled ? BRAND.filePrefix : 'acme'}_2026-08.txt`;

/** ~30 characters a second. */
const CHARS_PER_SECOND = 30;

const STAGES = [
  {
    key: 'attendance',
    label: 'Attendance',
    detail: '22 of 22 days · 0 LOP · synced into the run through one endpoint',
    outputs: [] as readonly string[],
  },
  {
    key: 'run',
    label: 'Payroll run',
    detail: 'PF at the ceiling, ESI locked for the period, PT by state, cumulative TDS',
    outputs: [] as readonly string[],
  },
  {
    key: 'filings',
    label: 'Statutory output',
    detail: 'Written in EPFO and NSDL formats, per legal entity',
    outputs: ['PF ECR', 'ESI Challan', 'Form 24Q · FVU', 'PT · LWF · Form 16'] as readonly string[],
  },
];

/** Nine of the 37. The chip that follows says how many are left. */
const PT_SAMPLE = [
  'Maharashtra',
  'Karnataka',
  'West Bengal',
  'Tamil Nadu',
  'Gujarat',
  'Telangana',
  'Delhi — none',
  'Haryana — none',
  'Uttar Pradesh — none',
];

export default function ComplianceBytes() {
  const reduced = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(reduced ? STAGES.length - 1 : 0);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start 0.9', 'end 0.75'],
  });

  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    if (reduced) return;
    setStage(Math.min(STAGES.length - 1, Math.max(0, Math.floor(p * STAGES.length))));
  });

  return (
    // `relative`: this is a useScroll target, and framer-motion measures those
    // against the offset parent — a `static` element reports wrong offsets.
    <section ref={sectionRef} className="relative bg-slate-950 py-20 text-white sm:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
            Statutory compliance
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Not “compliance handled”. The actual bytes.
          </h2>
          <p className="mt-4 text-base leading-7 text-white/70">
            One row of a PF ECR return, in the format EPFO reads, assembled from the same figures
            as the payslip. Every number below traces to a rule, and the rule is named.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:gap-12">
          {/* ── The flow ─────────────────────────────────────────── */}
          <ol className="grid gap-3" data-claim="TIM-09">
            {STAGES.map((s, i) => (
              <li key={s.key}>
                <div
                  className={`rounded-xl border px-4 py-3.5 transition-[background-color,border-color,transform] duration-500 ${
                    i <= stage
                      ? 'border-blue-300/60 bg-white/10 lg:scale-[1.02]'
                      : 'border-white/15 bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${
                        i <= stage ? 'bg-blue-300' : 'bg-white/30'
                      }`}
                      aria-hidden="true"
                    />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">
                      {s.label}
                    </p>
                  </div>
                  <p className="mt-2 text-[13px] leading-5 text-white/65">{s.detail}</p>

                  {s.outputs.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {s.outputs.map((o) => (
                        <li
                          key={o}
                          className={`rounded-md px-2 py-1 font-mono text-[10.5px] transition-colors duration-500 ${
                            i <= stage ? 'bg-blue-400/20 text-blue-100' : 'bg-white/[0.06] text-white/40'
                          }`}
                        >
                          {o}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {i < STAGES.length - 1 && (
                  <div className="ml-6 h-5 w-px bg-white/15" aria-hidden="true">
                    <div
                      className={`h-full w-full origin-top bg-blue-400 transition-transform duration-500 ${
                        i < stage ? 'scale-y-100' : 'scale-y-0'
                      }`}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>

          {/* ── The terminal ─────────────────────────────────────── */}
          <div>
            <EcrTerminal reduced={reduced} />

            <dl className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {ECR_FIELDS.map((f) => (
                <div key={f.label} className="border-t border-white/10 pt-2">
                  <dt className="text-[11px] font-semibold text-white/80">{f.label}</dt>
                  <dd className="mt-0.5 font-mono text-[11px] text-blue-200">{f.value}</dd>
                  <dd className="text-[10.5px] leading-4 text-white/50">{f.note}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* ── Professional tax, where tools quietly go wrong ────── */}
        <div className="mt-14 border-t border-white/10 pt-8" data-claim="STA-04">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-lg font-bold text-white">
              Professional tax is levied by the state, not the country.
            </h3>
            <p className="text-[13px] text-white/60">20 levy it · 17 levy none</p>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
            A state that levies no professional tax returns ₹0 — never a neighbour’s slab.
            Defaulting an unset state to a real one is the failure mode that puts a deduction on a
            payslip no authority will ever collect.
          </p>
          <ul className="mt-5 flex flex-wrap gap-1.5">
            {PT_SAMPLE.map((name) => (
              <li
                key={name}
                className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11.5px] text-white/75"
              >
                {name}
              </li>
            ))}
            <li className="rounded-full border border-blue-300/40 bg-blue-400/15 px-2.5 py-1 text-[11.5px] font-semibold text-blue-100">
              + the rest of 37
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function EcrTerminal({ reduced }: { reduced: boolean }) {
  const codeRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // 0.3, not 0.5: this card is tall, and on a short viewport half of it is
  // never on screen at once — which would mean the typing never triggers.
  const inView = useInView(cardRef, { once: true, amount: 0.3 });
  const [done, setDone] = useState(reduced);

  /*
   * THE CLEAR HAPPENS IN THE SAME EFFECT AS THE TYPING, not in a mount-time
   * `useLayoutEffect` of its own.
   *
   * It used to be separate, and that lost the bytes entirely: the layout effect
   * blanked the line at mount, while typing was gated on `useInView(…, {amount:
   * 0.5})`. A reader who scrolled past quickly — or whose viewport never showed
   * half of this card at once — never satisfied the in-view condition, so the
   * typing effect never ran and the terminal sat permanently EMPTY. The one
   * piece of proof the section exists for, deleted by its own animation.
   *
   * Clearing here keeps the no-flash property that motivated the layout effect
   * (the blank is written synchronously, before the first typed frame paints)
   * while making it impossible to blank the line without also typing it back.
   */
  useEffect(() => {
    if (reduced || !inView) return;
    const node = codeRef.current;
    if (!node) return;

    node.textContent = '';

    let raf = 0;
    let cancelled = false;
    const start = performance.now();
    const total = (ECR_LINE.length / CHARS_PER_SECOND) * 1000;

    const tick = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / total);
      node.textContent = ECR_LINE.slice(0, Math.ceil(t * ECR_LINE.length));
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        node.textContent = ECR_LINE;
        setDone(true);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      // Interrupted mid-type: leave the COMPLETE line, never a truncated one.
      // A half-written statutory record is a worse artefact than no animation.
      node.textContent = ECR_LINE;
    };
  }, [reduced, inView]);

  return (
    <div
      ref={cardRef}
      className="overflow-hidden rounded-xl border border-white/15 bg-black/40 shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-white/25" />
          <span className="h-2 w-2 rounded-full bg-white/25" />
          <span className="h-2 w-2 rounded-full bg-white/25" />
        </span>
        <p className="font-mono text-[11px] text-white/50">{ECR_FILENAME}</p>
      </div>

      <div className="px-3.5 py-4">
        {/* `break-all` on purpose: the line has no spaces, and a horizontal
            scroller here would hide the very fields the legend points at. */}
        <pre className="font-mono text-[11.5px] leading-5 whitespace-pre-wrap break-all text-blue-200">
          <code ref={codeRef}>{ECR_LINE}</code>
          {!done && !reduced && (
            <span
              className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-blue-300"
              aria-hidden="true"
            />
          )}
        </pre>
      </div>

      <p className="border-t border-white/10 px-3.5 py-2.5 text-[11px] leading-4 text-white/50">
        Eleven fields, <span className="font-mono">||</span> delimited, in EPFO’s column order.
        Column 1 is the UAN — a blank one and EPFO rejects the whole upload, which is why the
        product refuses to report the filing ready without it.
      </p>
    </div>
  );
}
