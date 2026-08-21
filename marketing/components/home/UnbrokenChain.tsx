import type { ReactNode } from 'react';
import {
  TrackerCapture,
  AttendanceMonth,
  PayrollRun,
  StatutoryBreakdown,
  FilingsList,
  Payslip,
} from '@/components/product/screens';
import { Panel } from '@/components/product/Frame';
import { inr } from '@/lib/demo';
import { Container, Eyebrow, SectionTitle, Lead, cn } from '@/components/ui/primitives';

/**
 * Section 4 — the centrepiece.
 *
 * The brief asks for a "horizontal scroll-linked sequence". This is a
 * horizontally scrollable track with CSS scroll-snap, driven entirely by the
 * reader's own scroll — NOT a pinned section that hijacks the page scrollbar.
 * Scroll-jacking is on the do-not-build list for good reason: it breaks the
 * scrollbar's meaning, strands keyboard users, and is miserable on a trackpad.
 *
 * Native overflow gets the same choreography for free, keeps momentum scrolling
 * on touch, and remains fully keyboard-operable because each stage is a real
 * focusable region that the browser scrolls into view on Tab.
 *
 * Server component: all seven stages, and every figure in them, are in the
 * server-rendered HTML.
 */

interface Stage {
  n: number;
  title: string;
  claim: string;
  body: string;
  screen: ReactNode;
}

const STAGES: Stage[] = [
  {
    n: 1,
    title: 'The tracker captures the work',
    claim: 'TIM-01',
    body: 'A desktop app takes screenshots, reads OS-level idle, and queues everything to disk when the network drops. Idle time is rewound to the last real activity, so a late stop never bills the gap.',
    screen: <TrackerCapture />,
  },
  {
    n: 2,
    title: 'Activity becomes attendance',
    claim: 'TIM-03',
    body: 'Sessions are classified against configurable productivity rules, then resolved against the employee’s shift and timezone into an attendance record with hours, LOP and regularisations.',
    screen: <AttendanceMonth />,
  },
  {
    n: 3,
    title: 'Attendance syncs into the run',
    claim: 'TIM-09',
    body: 'One endpoint, per run or per employee, with a status you can inspect before you trust it. This is the join every competitor makes you do with a CSV.',
    screen: <SyncStage />,
  },
  {
    n: 4,
    title: 'The engine computes the pay',
    claim: 'PAY-01',
    body: 'CTC to components through a configurable structure, with a residual component absorbing the remainder so the total returns to CTC exactly — to the paisa.',
    screen: <PayrollRun />,
  },
  {
    n: 5,
    title: 'Statutory is applied, not bolted on',
    claim: 'STA-03',
    body: 'PF at the ₹15,000 ceiling, ESI locked for the contribution period, professional tax by state, TDS cumulative across the year on either regime.',
    screen: <StatutoryBreakdown />,
  },
  {
    n: 6,
    title: 'Returns and the bank file are generated',
    claim: 'FIL-01',
    body: 'Real EPFO ECR and NSDL formats. The bank file is a NEFT/RTGS batch that records every line, and returns unpayable people as exclusions rather than dropping them.',
    screen: <FilingsList />,
  },
  {
    n: 7,
    title: 'The payslip is the same record',
    claim: 'PAY-04',
    body: 'Every figure traces back through the version that produced it, the override that moved it, and the person who approved that override.',
    screen: <Payslip />,
  },
];

export function UnbrokenChain() {
  return (
    <section id="chain" className="overflow-hidden py-16 sm:py-20 lg:py-24">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow>The unbroken chain</Eyebrow>
          <SectionTitle className="mt-3">
            Seven stages. One system. No export step anywhere in it.
          </SectionTitle>
          <Lead className="mt-4">
            Every competitor in this market stitches a tracker to an HRMS to a payroll engine
            across three vendors. Here is what it looks like when one product owns the whole
            chain — the same employee, the same month, all the way through.
          </Lead>
        </div>
      </Container>

      {/*
        Bleeds to the viewport edge so the track reads as continuing past the
        screen rather than stopping at a container margin — which is the visual
        cue that tells a reader to scroll it sideways at all.
      */}
      <div
        className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-5 pb-6 sm:px-6 lg:px-8 [scrollbar-width:thin]"
        // Scrollable regions must be reachable and announced. Without these a
        // keyboard user cannot scroll the track at all.
        tabIndex={0}
        role="group"
        aria-label="The seven stages, scroll horizontally"
      >
        {STAGES.map((stage) => (
          <article
            key={stage.n}
            data-claim={stage.claim}
            className="w-[19rem] shrink-0 snap-start sm:w-[21rem]"
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold tnum',
                  stage.n === 7 ? 'bg-accent-400 text-[rgb(var(--cta-to))]' : 'bg-brand-700 text-on-brand'
                )}
              >
                {stage.n}
              </span>
              {stage.n < 7 && (
                <span className="h-px flex-1 bg-gradient-to-r from-brand-300 to-transparent" aria-hidden="true" />
              )}
            </div>

            <h3 className="mt-3 font-display text-[17px] leading-snug font-bold text-balance text-n-900">
              {stage.title}
            </h3>
            <p className="mt-2 text-[13.5px] leading-6 text-pretty text-n-600">{stage.body}</p>

            <div className="mt-4">{stage.screen}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Stage 3 has no single screen in the product — it is an API handoff. */
function SyncStage() {
  return (
    <Panel label="Attendance sync · status">
      <div className="p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100" aria-hidden="true">
            <svg viewBox="0 0 12 12" className="h-3 w-3 text-emerald-700" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 6.2 4.8 8.5 9.5 3.8" />
            </svg>
          </span>
          <p className="text-[12.5px] font-semibold text-n-900">42 of 42 employees synced</p>
        </div>

        <dl className="mt-3 grid gap-1.5 border-t border-n-100 pt-3 text-[12px]">
          <div className="flex justify-between">
            <dt className="text-n-600">Source</dt>
            <dd className="font-medium text-n-700">Attendance records · Aug 2026</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-n-600">Paid days</dt>
            <dd className="font-semibold text-n-800 tnum">22</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-n-600">Loss of pay</dt>
            <dd className="font-semibold text-n-800 tnum">0 days</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-n-600">Basis for gross</dt>
            <dd className="font-semibold text-n-900 tnum">{inr(115891.2, true)}</dd>
          </div>
        </dl>

        {/* The line that is the whole differentiator, stated plainly. */}
        <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 font-mono text-[10.5px] leading-4 text-brand-800">
          POST /payroll/runs/&#123;runId&#125;/sync-attendance
        </p>
      </div>
    </Panel>
  );
}
