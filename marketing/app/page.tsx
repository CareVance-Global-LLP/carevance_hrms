import type { Metadata } from 'next';
import { SITE, CTA } from '@/lib/site';
import { faqSchema, JsonLd } from '@/lib/schema';
import { Button, Container, Eyebrow, Section, SectionTitle } from '@/components/ui/primitives';
import { ChainHero } from '@/components/home/ChainHero';
import { CapabilityTabs, type Capability } from '@/components/home/CapabilityTabs';
import { UnbrokenChain } from '@/components/home/UnbrokenChain';
import {
  ProofStrip,
  ProblemSection,
  ExplainabilitySection,
  SeatsSection,
  ComplianceSection,
  SecuritySection,
  PricingPreview,
  SwitchingSection,
  FaqSection,
  FinalCta,
  HOME_FAQS,
} from '@/components/home/sections';
import {
  PayrollRun,
  TrackerCapture,
  StatutoryBreakdown,
  MobileApprovals,
  DifferencesReport,
  EmployerCost,
  RunLifecycle,
} from '@/components/product/screens';

export const metadata: Metadata = {
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.description,
  alternates: { canonical: '/' },
};

/* ── 5 · Capability tabs ──────────────────────────────────────────────── */

const CAPABILITIES: Capability[] = [
  {
    key: 'payroll',
    label: 'Payroll',
    headline: 'Indian payroll, and the arithmetic to prove it.',
    body: 'A run moves through draft, locked, approved, released and disbursed — each stage stamped with who did it and when. Processing is queued with a progress handle you can poll, and a second start while one is in flight is refused rather than allowed to race.',
    points: [
      { text: 'Salary structures built from formula, slab and lookup components', claim: 'PAY-03' },
      { text: 'Every payroll item versioned, with per-employee locks', claim: 'PAY-04' },
      { text: 'Arrears, LOP, pro-rating, notice recovery and F&F in the engine', claim: 'PAY-07' },
      { text: 'Negative net pay is surfaced for validation, never clamped to zero', claim: 'PAY-08' },
    ],
    screen: (
      <div className="grid gap-3">
        <RunLifecycle />
        <PayrollRun />
      </div>
    ),
  },
  {
    key: 'time',
    label: 'Time & attendance',
    headline: 'The evidence and the hour are the same record.',
    body: 'A desktop tracker with screenshots and OS-level idle detection, a browser extension for URL context, geofenced mobile punch and attendance selfies — resolved against shifts, overtime rules and comp-off into the attendance the payroll run reads.',
    points: [
      { text: 'Offline queue persists captures to disk when the network drops', claim: 'TIM-01' },
      { text: 'Idle rewinds to the last real activity — recorded, never billed', claim: 'TIM-04' },
      { text: 'A server-side sweep closes idle timers the desktop app cannot', claim: 'TIM-05' },
      { text: 'Regularisation requests can be forwarded to the right approver', claim: 'TIM-08' },
    ],
    screen: (
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <TrackerCapture />
        <MobileApprovals className="mx-auto sm:mx-0" />
      </div>
    ),
  },
  {
    key: 'compliance',
    label: 'Compliance',
    headline: 'The rules, applied — including the ones tools get wrong.',
    body: 'PF at the ₹15,000 ceiling with the EPS split, ESI locked for the contribution period, professional tax across 37 states and union territories, and cumulative TDS on either regime. Then thirteen real statutory outputs, in EPFO and NSDL formats.',
    points: [
      { text: 'ESI coverage fixed Apr–Sep and Oct–Mar, not tested month by month', claim: 'STA-03' },
      { text: 'States that levy no PT return ₹0 — never a neighbour’s slab', claim: 'STA-04' },
      { text: 'A filing reports not-ready when PAN or TAN is missing', claim: 'FIL-04' },
      { text: 'One broken generator cannot kill the batch', claim: 'FIL-03' },
    ],
    screen: (
      <div className="grid gap-3">
        <StatutoryBreakdown />
        <EmployerCost />
      </div>
    ),
  },
  {
    key: 'people',
    label: 'People',
    headline: 'From an accepted offer to a final settlement.',
    body: 'Hiring opens an onboarding journey automatically — an eighteen-step checklist spanning day −14 to +90 across six owner roles, with blocking gates. Exit runs the same machinery in reverse: notice period, checklist, access revocation, interview, full and final.',
    points: [
      { text: 'A joiner sees and completes only their own checklist items', claim: 'HR-03' },
      { text: 'Future joining dates are valid — pre-boarding is the normal path', claim: 'HR-04' },
      { text: 'Payroll readiness is checked in lifecycle, not found on run day', claim: 'HR-09' },
      { text: 'Salary revision letters are accepted or rejected by the employee', claim: 'HR-07' },
    ],
    screen: (
      <div className="grid gap-3">
        <RunLifecycle />
        <DifferencesReport />
      </div>
    ),
  },
  {
    key: 'reports',
    label: 'Reports',
    headline: 'Find the mistake before the money moves.',
    body: 'Four detective reports run against a payroll run: what differs from last month and why, which employees carry a negative cost, which records are duplicated, and whether the run reconciles. Then the payroll and statutory registers finance actually asks for.',
    points: [
      { text: 'Differences report names the override that moved each component', claim: 'CTL-01' },
      { text: 'Negative-cost and duplicate detection before disbursement', claim: 'CTL-02' },
      { text: 'GL mapping and cost centres for the finance hand-off', claim: 'RPT-03' },
      { text: 'Burn rate and CTC planning across the org', claim: 'RPT-04' },
    ],
    screen: (
      <div className="grid gap-3">
        <DifferencesReport />
        <PayrollRun />
      </div>
    ),
  },
];

export default function HomePage() {
  return (
    <>
      <JsonLd schema={faqSchema(HOME_FAQS.map((f) => ({ q: f.q, a: f.a })))} />

      {/* ── 1 · Hero ──────────────────────────────────────────────────── */}
      <section className="pt-14 pb-12 sm:pt-20 lg:pt-24 lg:pb-16">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>HR &amp; payroll, built for India</Eyebrow>

            {/*
              The LCP element, and it is real text that paints immediately.
              Nothing here animates in: an entrance animation above the fold
              delays LCP, and the budget is under 2 seconds on mobile 4G.
            */}
            <h1 className="mt-4 font-display text-hero text-balance text-n-900">
              The hours are the payslip.
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-pretty text-n-600">
              CareVance tracks the work, computes the payroll, and files the compliance — in one
              unbroken system. No exports. No reconciliation. No third tool.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button href={CTA.demo.href} size="lg">
                {CTA.demo.label}
              </Button>
              <Button href={CTA.tour.href} tone="secondary" size="lg">
                {CTA.tour.label}
              </Button>
            </div>

            <p className="mt-5 text-[13px] text-n-600">
              14-day free trial · no credit card · web, mobile, desktop tracker and browser
              extension
            </p>
          </div>

          <div className="mt-14 lg:mt-16">
            <ChainHero />
          </div>
        </Container>
      </section>

      {/* ── 2 · Proof strip ───────────────────────────────────────────── */}
      <ProofStrip />

      {/* ── 3 · The problem ───────────────────────────────────────────── */}
      <ProblemSection />

      {/* ── 4 · The unbroken chain ────────────────────────────────────── */}
      <UnbrokenChain />

      {/* ── 5 · Capability tabs ───────────────────────────────────────── */}
      <Section tone="sunken" id="tour">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>What is inside</Eyebrow>
            <SectionTitle className="mt-3">
              Five modules that already share one database.
            </SectionTitle>
          </div>
          <div className="mt-10">
            <CapabilityTabs items={CAPABILITIES} />
          </div>
        </Container>
      </Section>

      {/* ── 6 · Explainability ────────────────────────────────────────── */}
      <ExplainabilitySection />

      {/* ── 7 · Every seat ────────────────────────────────────────────── */}
      <SeatsSection />

      {/* ── 8 · India-deep compliance ─────────────────────────────────── */}
      <ComplianceSection />

      {/* ── 9 · Security ──────────────────────────────────────────────── */}
      <SecuritySection />

      {/* ── 10 · Pricing preview ──────────────────────────────────────── */}
      <PricingPreview />

      {/* ── 11 · Switching ────────────────────────────────────────────── */}
      <SwitchingSection />

      {/* ── 12 · FAQ ──────────────────────────────────────────────────── */}
      <FaqSection />

      {/* ── 13 · Final CTA ────────────────────────────────────────────── */}
      <FinalCta />
    </>
  );
}
