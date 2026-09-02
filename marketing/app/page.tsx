import type { Metadata } from 'next';
import { SITE, CTA } from '@/lib/site';
import { faqSchema, JsonLd } from '@/lib/schema';
import { Button, Container, Eyebrow, Section, SectionTitle } from '@/components/ui/primitives';
import { ChainHero, type ChainNode } from '@/components/home/ChainHero';
import {
  EMPLOYEE,
  PERIOD,
  TRACKED,
  ATTENDANCE,
  GROSS,
  NET_PAY,
  num,
  ECR_LINE,
  ECR_FILENAME,
  ECR_FIELDS,
} from '@/lib/demo';
import { PT_LEVYING_COUNT, PT_NIL_COUNT } from '@/lib/pt-states';
import { CapabilityTabs, type Capability } from '@/components/home/CapabilityTabs';
import { WordReveal, FadeUp, TiltGroup } from '@/components/home/HeroMotion';
import { ProductTour, type TourStep } from '@/components/home/ProductTour';
import { SplitFlow } from '@/components/home/SplitFlow';
import { ComplianceTerminal } from '@/components/home/ComplianceTerminal';
import { PrivacyDemo } from '@/components/home/PrivacyDemo';
import { CostCalculator } from '@/components/home/CostCalculator';
import { DayOne } from '@/components/home/DayOne';
import { ModuleMarquee } from '@/components/home/ModuleMarquee';
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
  AttendanceMonth,
  Payslip,
} from '@/components/product/screens';

export const metadata: Metadata = {
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.description,
  alternates: { canonical: '/' },
};

/* ── 1 · The hero chain ───────────────────────────────────────────────── */

/**
 * Built here, on the server, and passed into the client component.
 *
 * The five fragments carry ONE employee and ONE number from a tracked minute to
 * a payslip. Assembling the array server-side keeps lib/demo — which holds every
 * figure the rest of the site renders — out of the browser bundle entirely.
 */
const CHAIN: readonly ChainNode[] = [
  {
    key: 'tracked',
    stage: 'Tracked',
    caption: TRACKED.dateShort,
    value: TRACKED.hours,
    detail: `${TRACKED.activeShare}% active · ${TRACKED.idleRecovered} idle rewound`,
    tone: 'dark',
  },
  {
    key: 'attendance',
    stage: 'Attendance',
    caption: PERIOD.monthShort,
    value: `${ATTENDANCE.present}/${ATTENDANCE.workingDays}`,
    detail: `${ATTENDANCE.totalHours} · ${ATTENDANCE.lop} LOP days`,
    tone: 'light',
  },
  {
    key: 'run',
    stage: 'Payroll run',
    caption: EMPLOYEE.name,
    value: num(GROSS),
    detail: 'gross, from the synced attendance',
    tone: 'light',
  },
  {
    key: 'statutory',
    stage: 'Statutory',
    caption: 'PF · PT · TDS',
    value: '8,704',
    detail: 'ESI nil — gross above ₹21,000',
    tone: 'light',
  },
  {
    key: 'payslip',
    stage: 'Payslip',
    caption: EMPLOYEE.name,
    value: num(NET_PAY),
    detail: 'net pay, paid by bank file',
    tone: 'brand',
  },
];

/* ── 4 · The scroll-linked tour ───────────────────────────────────────── */

/**
 * Four steps, four real screens, assembled on the server.
 *
 * The `screen` values are React elements built here rather than imported inside
 * ProductTour, for the same reason CHAIN is: that component is a client
 * component, and importing lib/demo or the screen mocks into it would ship the
 * whole demo dataset to the browser.
 *
 * Callout coordinates are percentages over the sticky frame. They are
 * deliberately loose — they point at a region, not a pixel, so a screen that
 * re-flows at a different breakpoint does not leave a label indicating nothing.
 */
const TOUR: readonly TourStep[] = [
  {
    key: 'track',
    label: 'Track',
    claim: 'TIM-01',
    title: 'The work is captured as it happens.',
    body: 'A desktop tracker takes screenshots and reads OS-level idle; the browser extension adds URL context. When the network drops, captures queue to disk rather than evaporating.',
    screen: <TrackerCapture />,
    callouts: [
      { x: 0, y: 24, text: '31 captures · consent-gated' },
      { x: 0, y: 72, text: '18m idle, rewound off the clock' },
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
      { x: 0, y: 26, text: '22 of 22 days · 0 LOP' },
      { x: 0, y: 68, text: 'One regularisation, forwarded to the right approver' },
    ],
  },
  {
    key: 'approve',
    label: 'Approve',
    claim: 'CTL-01',
    title: 'The mistake is found before the money moves.',
    body: 'A run walks draft → locked → approved → released → disbursed, each stage stamped. The differences report names the override that moved each component, so nothing changes anonymously.',
    screen: (
      <div className="grid gap-3">
        <RunLifecycle />
        <DifferencesReport />
      </div>
    ),
    callouts: [
      { x: 0, y: 30, text: 'Five stages, each stamped with who and when' },
      { x: 0, y: 62, text: 'Override #418 — named, not just diffed' },
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
      { x: 0, y: 22, text: 'The same ₹1,07,187 from the top of the page' },
      { x: 0, y: 74, text: 'Unpayable people excluded by name, never dropped' },
    ],
  },
];

/* ── 8 · Privacy ──────────────────────────────────────────────────────── */

const PRIVACY_POINTS = [
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
              The LCP element, and it now animates — see the header of
              HeroMotion.tsx for what that costs and why it is the instructed
              trade. The text itself is server-rendered either way; a reader
              with no JS gets the headline as one plain sentence.
            */}
            <WordReveal
              text="The hours are the payslip."
              className="mt-4 font-display text-hero text-balance text-n-900"
            />

            <FadeUp delay={0.34}>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-pretty text-n-600">
                CareVance tracks the work, computes the payroll, and files the compliance — in one
                unbroken system. No exports. No reconciliation. No third tool.
              </p>
            </FadeUp>

            <FadeUp delay={0.46}>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button href={CTA.demo.href} size="lg">
                  {CTA.demo.label}
                </Button>
                <Button href={CTA.tour.href} tone="secondary" size="lg">
                  {CTA.tour.label}
                </Button>
              </div>
            </FadeUp>

            <FadeUp delay={0.6}>
              <p className="mt-5 text-[13px] text-n-600">
                14-day free trial · no credit card · web, mobile, desktop tracker and browser
                extension
              </p>
            </FadeUp>
          </div>

          {/* The tilt lives on the wrapper; anime.js still owns the cards. */}
          <TiltGroup className="mt-14 lg:mt-16">
            <ChainHero nodes={CHAIN} />
          </TiltGroup>
        </Container>
      </section>

      {/* ── 2 · Proof strip ───────────────────────────────────────────── */}
      <ProofStrip />

      {/* ── 2b · What changes on day one ──────────────────────────────── */}
      <DayOne />

      {/* ── 2c · The modules, scrolling ───────────────────────────────── */}
      <ModuleMarquee />

      {/* ── 3 · The problem, and what it costs ────────────────────────── */}
      <ProblemSection />

      <Section className="pt-0">
        <Container>
          <div className="mx-auto max-w-2xl">
            <CostCalculator />
          </div>
        </Container>
      </Section>

      {/* ── 4 · The scroll-linked tour ────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>One record, four steps</Eyebrow>
            <SectionTitle className="mt-3">
              Follow one tracked minute all the way to a paid payslip.
            </SectionTitle>
          </div>
          <div className="mt-12">
            <ProductTour steps={TOUR} />
          </div>
        </Container>
      </Section>

      {/* ── 5 · Tracking and payroll, from one record ─────────────────── */}
      <SplitFlow />

      {/* ── 6 · The statutory bytes ───────────────────────────────────── */}
      <ComplianceTerminal
        line={ECR_LINE}
        filename={ECR_FILENAME}
        fields={ECR_FIELDS}
        ptLevying={PT_LEVYING_COUNT}
        ptNil={PT_NIL_COUNT}
        ptSample={[
          'Maharashtra',
          'Karnataka',
          'West Bengal',
          'Tamil Nadu',
          'Gujarat',
          'Telangana',
          'Delhi — none',
          'Haryana — none',
          'Uttar Pradesh — none',
        ]}
      />

      {/* ── 7 · Privacy, demonstrated ─────────────────────────────────── */}
      <PrivacyDemo capture={<TrackerCapture />} points={PRIVACY_POINTS} />

      {/* ── 8 · Capability tabs ───────────────────────────────────────── */}
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
