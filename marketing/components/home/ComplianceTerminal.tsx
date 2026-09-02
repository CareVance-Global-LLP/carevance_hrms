'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInView, useMotionValueEvent, useScroll } from 'motion/react';
import { cn } from '@/components/ui/primitives';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

/**
 * §6 — the statutory section, and the most load-bearing proof on the page.
 *
 * Every payroll vendor in India says "statutory compliance, handled". The claim
 * is unfalsifiable at the marketing layer, so buyers have learned to discount
 * it. What cannot be discounted is the file itself: eleven `||`-delimited
 * fields in EPFO's column order, with a legend saying where each number came
 * from and how it relates to the payslip two sections up.
 *
 * A competitor generating its returns in a spreadsheet cannot put this on a
 * landing page, which is exactly why it belongs on ours.
 *
 * THE BYTES ARE NOT PROP COPY. `ECR_LINE` in lib/demo.ts is assembled from the
 * same constants that produce the payslip, in the format that
 * `PayrollFilingService::generatePfEcr()` writes. If the demo employee's PF
 * changes, this line changes with it — there is no second place to edit.
 *
 * TYPING, AND WHY THE TEXT IS IN THE HTML ANYWAY. The finished line is
 * server-rendered. `useLayoutEffect` clears it before the browser paints —
 * never `useEffect`, which would paint the full line and then visibly retype
 * it. If JS fails, the reader keeps the bytes. Same rule as ChainHero: fail
 * visible.
 */

export interface EcrField {
  label: string;
  value: string;
  note: string;
}

interface Stage {
  key: string;
  label: string;
  detail: string;
  outputs?: readonly string[];
}

const STAGES: readonly Stage[] = [
  {
    key: 'attendance',
    label: 'Attendance',
    detail: '22 of 22 days · 0 LOP · synced into the run through one endpoint',
  },
  {
    key: 'run',
    label: 'Payroll run',
    detail: 'PF at the ceiling, ESI locked for the period, PT by state, cumulative TDS',
  },
  {
    key: 'filings',
    label: 'Statutory output',
    detail: 'Written in EPFO and NSDL formats, per legal entity',
    outputs: ['PF ECR', 'ESI Challan', 'Form 24Q · FVU', 'PT · LWF · Form 16'],
  },
];

/** ~30 characters a second, per the brief. */
const CHARS_PER_SECOND = 30;

export function ComplianceTerminal({
  line,
  filename,
  fields,
  ptLevying,
  ptNil,
  ptSample,
}: {
  line: string;
  filename: string;
  fields: readonly EcrField[];
  ptLevying: number;
  ptNil: number;
  ptSample: readonly string[];
}) {
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
    <section
      ref={sectionRef}
      data-cursor-theme="dark"
      className="band-deep py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-caption uppercase text-white/70">Statutory compliance</p>
          <h2 className="mt-3 font-display text-title text-balance text-white">
            Not “compliance handled”. The actual bytes.
          </h2>
          <p className="mt-4 text-lg leading-8 text-pretty text-white/80">
            One row of a PF ECR return, in the format EPFO reads, assembled from the same figures
            as the payslip above. Every number below traces to a rule, and the rule is named.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:gap-12">
          {/* ── The flow ─────────────────────────────────────────────── */}
          <ol className="grid gap-3" data-claim="TIM-09">
            {STAGES.map((s, i) => (
              <li key={s.key}>
                <div
                  className={cn(
                    'rounded-xl border px-4 py-3.5 transition-[background-color,border-color,transform] duration-500',
                    i <= stage
                      ? 'border-brand-300/60 bg-white/12 lg:scale-[1.02]'
                      : 'border-white/15 bg-white/[0.04]'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full transition-colors duration-500',
                        i <= stage ? 'bg-brand-300' : 'bg-white/30'
                      )}
                      aria-hidden="true"
                    />
                    <p className="text-caption uppercase text-white/80">{s.label}</p>
                  </div>
                  <p className="mt-2 text-[13px] leading-5 text-white/75">{s.detail}</p>

                  {s.outputs && (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {s.outputs.map((o) => (
                        <li
                          key={o}
                          className={cn(
                            'rounded-md px-2 py-1 font-mono text-[10.5px] transition-colors duration-500',
                            i <= stage
                              ? 'bg-brand-400/20 text-brand-100'
                              : 'bg-white/[0.06] text-white/45'
                          )}
                        >
                          {o}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* The connector between stages. A 1px rule that fills, rather
                    than an SVG — there is nothing here a path can say that a
                    line cannot, and this one costs no geometry. */}
                {i < STAGES.length - 1 && (
                  <div className="ml-6 h-5 w-px bg-white/15" aria-hidden="true">
                    <div
                      className={cn(
                        'h-full w-full origin-top bg-brand-400 transition-transform duration-500',
                        i < stage ? 'scale-y-100' : 'scale-y-0'
                      )}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>

          {/* ── The terminal ─────────────────────────────────────────── */}
          <div>
            <EcrTerminal line={line} filename={filename} reduced={reduced} />

            <dl className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.label} className="border-t border-white/12 pt-2">
                  <dt className="text-[11px] font-semibold text-white/85">{f.label}</dt>
                  <dd className="mt-0.5 font-mono text-[11px] text-brand-100">{f.value}</dd>
                  <dd className="text-[10.5px] leading-4 text-white/60">{f.note}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* ── Professional tax, which is where tools quietly go wrong ── */}
        <div className="mt-14 border-t border-white/12 pt-8" data-claim="STA-04">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-display text-lg font-bold text-white">
              Professional tax is levied by the state, not the country.
            </h3>
            <p className="text-[13px] text-white/70">
              {ptLevying} levy it · {ptNil} levy none
            </p>
          </div>
          <p className="mt-2 max-w-3xl text-[14px] leading-6 text-pretty text-white/75">
            A state that levies no professional tax returns ₹0 — never a neighbour&rsquo;s slab.
            Defaulting an unset state to a real one is the failure mode that puts a deduction on a
            payslip no authority will ever collect.
          </p>
          <ul className="mt-5 flex flex-wrap gap-1.5">
            {ptSample.map((name) => (
              <li
                key={name}
                className="rounded-full border border-white/18 bg-white/[0.06] px-2.5 py-1 text-[11.5px] text-white/80"
              >
                {name}
              </li>
            ))}
            <li className="rounded-full border border-brand-300/40 bg-brand-400/15 px-2.5 py-1 text-[11.5px] font-semibold text-brand-100">
              + the rest of 37
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function EcrTerminal({
  line,
  filename,
  reduced,
}: {
  line: string;
  filename: string;
  reduced: boolean;
}) {
  const codeRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inView = useInView(cardRef, { once: true, amount: 0.5 });
  const [done, setDone] = useState(reduced);

  /* Clear BEFORE paint, and only when motion is wanted. useEffect here would
     paint the finished line and then retype it in front of the reader. */
  useLayoutEffect(() => {
    if (reduced) return;
    if (codeRef.current) codeRef.current.textContent = '';
  }, [reduced]);

  useEffect(() => {
    if (reduced || !inView) return;
    const node = codeRef.current;
    if (!node) return;

    let raf = 0;
    let cancelled = false;
    const start = performance.now();
    const total = (line.length / CHARS_PER_SECOND) * 1000;

    const tick = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / total);
      node.textContent = line.slice(0, Math.ceil(t * line.length));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        node.textContent = line;
        setDone(true);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      // Interrupted mid-type: leave the complete line, never a truncated one.
      // A half-written statutory record is a worse artefact than no animation.
      node.textContent = line;
    };
  }, [reduced, inView, line]);

  return (
    <div
      ref={cardRef}
      className="overflow-hidden rounded-xl border border-white/15 surface-fixed-dark shadow-modal"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-white/25" />
          <span className="h-2 w-2 rounded-full bg-white/25" />
          <span className="h-2 w-2 rounded-full bg-white/25" />
        </span>
        <p className="font-mono text-[11px] text-white/60">{filename}</p>
      </div>

      <div className="px-3.5 py-4">
        {/*
          `break-all` on purpose. The line has no spaces, and a horizontal
          scroller here would hide the very fields the legend is pointing at.
        */}
        <pre className="font-mono text-[11.5px] leading-5 break-all whitespace-pre-wrap text-brand-100">
          <code ref={codeRef}>{line}</code>
          {!done && !reduced && (
            <span
              className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-brand-300"
              aria-hidden="true"
            />
          )}
        </pre>
      </div>

      <p className="border-t border-white/10 px-3.5 py-2.5 text-[11px] leading-4 text-white/60">
        Eleven fields, <span className="font-mono">||</span> delimited, in EPFO&rsquo;s column
        order. Column 1 is the UAN — a blank one and EPFO rejects the whole upload, which is why
        the product refuses to report the filing ready without it.
      </p>
    </div>
  );
}
