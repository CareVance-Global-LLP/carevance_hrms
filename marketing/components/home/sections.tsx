import Link from 'next/link';
import { PROOF_STRIP, STATUTORY, SCALE, SECURITY } from '@/lib/facts';
import { PLANS, GST_PERCENT, TRIAL_DAYS, MIN_SEATS } from '@/lib/pricing';
import { CTA } from '@/lib/site';
import { CountUp } from '@/components/motion/CountUp';
import { StepArrows } from '@/components/home/StepArrows';
import { PricingCards, type PriceCard } from '@/components/home/PricingCards';
import { Reveal } from '@/components/motion/Reveal';
import { OverrideRegister, OverrideRefusal, ConsentNotice } from '@/components/product/screens';
import {
  Button,
  Card,
  Container,
  Eyebrow,
  Lead,
  Section,
  SectionTitle,
  cn,
} from '@/components/ui/primitives';

/* ── 2 · Proof strip ──────────────────────────────────────────────────── */

/**
 * No logo wall, because there are no logos. No customer count, because there
 * are no customers to count. What a new entrant honestly has is the size and
 * specificity of what it built — and every one of these is countable from the
 * repository, which is what /methodology exists to show.
 */
export function ProofStrip() {
  return (
    <section aria-label="What is built" className="border-y border-n-200 bg-card/60">
      <Container>
        <dl className="grid grid-cols-2 divide-n-200 py-8 sm:grid-cols-4 sm:divide-x">
          {PROOF_STRIP.map((f) => (
            <div key={f.id} data-claim={f.id} className="px-4 py-3 text-center sm:px-6">
              <dt className="sr-only">{f.label}</dt>
              <dd>
                <CountUp
                  value={f.value}
                  n={f.n}
                  title={f.source}
                  className="font-display text-3xl font-bold text-n-900"
                />
                <span className="mt-1 block text-[12.5px] leading-5 text-n-600">{f.label}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="pb-6 text-center text-[12px] text-n-600">
          Counted from the codebase, not estimated.{' '}
          <Link href="/methodology" className="underline underline-offset-4 hover:text-n-800">
            How we count
          </Link>
        </p>
      </Container>
    </section>
  );
}

/* ── 3 · The problem, named ───────────────────────────────────────────── */

const WITHOUT = [
  'A tracker from one vendor. An HRMS from another. Payroll from a third.',
  'Someone exports a CSV on the 25th and hopes the columns still line up.',
  'Attendance disputes are settled from memory, because the evidence is in a different tool.',
  'A salary component is changed, and nobody can say later what it cost or who approved it.',
  'The statutory return disagrees with what was actually deducted, and you find out at filing.',
];

const WITH = [
  'One system owns the tracker, the attendance record and the payroll run.',
  'Attendance syncs into the run through an endpoint you can inspect before you trust it.',
  'The screenshot, the activity classification and the hour it produced are the same record.',
  'Every override carries the engine value beside the applied one, and an append-only audit.',
  'ESI stays locked for the contribution period, so the return and the deduction agree.',
];

export function ProblemSection() {
  return (
    <Section tone="sunken">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow>The actual problem</Eyebrow>
          <SectionTitle className="mt-3">
            Your tracker doesn’t talk to your HRMS. Your HRMS doesn’t talk to your payroll.
          </SectionTitle>
          <Lead className="mt-4">
            So someone exports a CSV every month and hopes. For most companies this size the real
            competitor isn’t a rival platform — it’s five disconnected tools and a spreadsheet
            holding them together.
          </Lead>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <Card className="p-6">
            <p className="flex items-center gap-2 text-caption uppercase text-n-600">
              <span className="h-1.5 w-1.5 rounded-full bg-n-400" aria-hidden="true" />
              Without CareVance
            </p>
            <ul className="mt-4 grid gap-3">
              {WITHOUT.map((line) => (
                <li key={line} className="flex gap-3 text-[14.5px] leading-6 text-n-600">
                  <svg viewBox="0 0 16 16" className="mt-1.5 h-3 w-3 shrink-0 text-n-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                  {line}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="border-brand-200 bg-brand-50/50 p-6">
            <p className="flex items-center gap-2 text-caption uppercase text-brand-700">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
              With CareVance
            </p>
            <ul className="mt-4 grid gap-3">
              {WITH.map((line) => (
                <li key={line} className="flex gap-3 text-[14.5px] leading-6 text-n-700">
                  <svg viewBox="0 0 16 16" className="mt-1.5 h-3 w-3 shrink-0 text-brand-600" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 8.5 6.2 11.6 13 4.6" />
                  </svg>
                  {line}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Container>
    </Section>
  );
}

/* ── 6 · Explainability ───────────────────────────────────────────────── */

export function ExplainabilitySection() {
  return (
    <Section>
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:items-center lg:gap-14">
          <div>
            <Eyebrow>Explainability</Eyebrow>
            <SectionTitle className="mt-3">
              Every rupee on the payslip can name the rule that put it there.
            </SectionTitle>
            <p className="mt-4 leading-7 text-pretty text-n-600">
              Competitors show you <em>what</em> changed. The override register shows you{' '}
              <em>why</em>: the applied value sits beside the value the engine would have
              produced, and the difference is attributed to the override that caused it.
            </p>

            <div data-claim="OVR-02" className="mt-6 rounded-xl border border-n-200 bg-sunken p-5">
              <p className="font-display text-lg font-bold text-n-900">
                Raising Basic by ₹1 does not cost ₹1. It costs{' '}
                <span className="text-brand-700 tnum">₹{STATUTORY.amplification.value}</span>.
              </p>
              <p className="mt-2 text-[14px] leading-6 text-n-600">
                HRA is derived from Basic. Employer PF and the gratuity provision sit inside the
                CTC envelope. Four quantities move together, so an admin who types “Basic 60,000”
                expecting Special Allowance to fall by ₹12,000 watches it fall by ₹20,016. The
                product shows that before you commit, rather than after.
              </p>
            </div>

            <p data-claim="OVR-01" className="mt-5 leading-7 text-pretty text-n-600">
              And when a value genuinely cannot balance, it is <strong>refused at entry</strong>{' '}
              — with the maximum that would work, named to the paisa. Not accepted now and
              rejected weeks later at finalisation, when the fix is expensive and the payroll
              calendar is already against you.
            </p>

            <ul className="mt-5 grid gap-2">
              {[
                { text: 'Maker-checker: proposed by one person, approved by another.', claim: 'OVR-05' },
                { text: 'Append-only audit trail on every override.', claim: 'OVR-06' },
                { text: 'CSV round-trip with a validate step before commit.', claim: 'OVR-07' },
              ].map((p) => (
                <li key={p.text} data-claim={p.claim} className="flex gap-2.5 text-[14.5px] leading-6 text-n-700">
                  <svg viewBox="0 0 16 16" className="mt-1.5 h-3 w-3 shrink-0 text-brand-600" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 8.5 6.2 11.6 13 4.6" />
                  </svg>
                  {p.text}
                </li>
              ))}
            </ul>
          </div>

          <Reveal className="grid gap-4">
            <OverrideRegister />
            <OverrideRefusal />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

/* ── 7 · Built for every seat ─────────────────────────────────────────── */

const SEATS = [
  {
    role: 'Founder',
    body: 'One number for what people actually cost, and a burn-rate view that does not require asking finance. Payroll stops being a monthly act of faith.',
  },
  {
    role: 'Finance',
    body: 'A payroll register, a statutory register, GL mapping and cost centres. Differences, duplicates and negative-cost reports before the money moves, not after.',
  },
  {
    role: 'HR & payroll admin',
    body: 'The run lifecycle as a real stepper, a pre-run checklist that blocks, and overrides that refuse impossible values while you are still looking at the screen.',
  },
  {
    role: 'Manager',
    body: 'Approvals for leave, time edits and expenses — on the phone, with the ability to forward a request to whoever should actually decide it.',
  },
  {
    role: 'Employee',
    body: 'Payslips, tax declarations with proof upload, an old-versus-new regime simulator, loans, reimbursements and their own onboarding checklist.',
  },
];

export function SeatsSection() {
  return (
    <Section tone="sunken">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow>Built for every seat</Eyebrow>
          <SectionTitle className="mt-3">
            HRMS is a committee purchase. Everyone in the room gets a reason.
          </SectionTitle>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SEATS.map((seat) => (
            <Card key={seat.role} interactive className="p-6">
              <h3 className="font-display text-[17px] font-bold text-n-900">{seat.role}</h3>
              <p className="mt-2 text-[14px] leading-6 text-pretty text-n-600">{seat.body}</p>
            </Card>
          ))}
        </div>
      </Container>
    </Section>
  );
}

/* ── 8 · India-deep compliance ────────────────────────────────────────── */

const RULES = [
  {
    claim: 'STA-03',
    title: 'ESI stays locked for the contribution period',
    body: 'Coverage is fixed for a whole period — 1 April to 30 September, 1 October to 31 March. Someone covered at the start stays covered to the end, even if a raise takes them past ₹21,000 in month three. Test a payroll tool on this one rule; most drop the employee the instant they cross.',
  },
  {
    claim: 'STA-01',
    title: 'PF at the ceiling, with the EPS split',
    body: 'Twelve percent each side of ₹15,000, and the employer’s half divided EPS 8.33% / EPF 3.67% rather than treated as one number. Above-ceiling handling and VPF are configurable, not assumed.',
  },
  {
    claim: 'STA-04',
    title: 'Professional tax is state-levied, and some states levy none',
    body: 'Thirty-seven states and union territories, month-aware — Maharashtra’s ₹300 February is modelled. A state with no PT returns ₹0, and is never quietly defaulted to a neighbour’s slab.',
  },
  {
    claim: 'STA-06',
    title: 'TDS is cumulative, on either regime',
    body: 'Not a flat twelfth of an annual guess. Old and new regime, FY-keyed slabs, surcharge bands with contiguous boundaries, and 4% cess — with a simulator employees can run themselves.',
  },
];

export function ComplianceSection() {
  return (
    <Section>
      <Container>
        <div className="max-w-2xl">
          <Eyebrow>India-deep, not India-available</Eyebrow>
          <SectionTitle className="mt-3">
            Anyone can say “statutory compliance”. Here are the rules, by name.
          </SectionTitle>
          <Lead className="mt-4">
            Specificity is the only honest trust device available to a company with no logo wall.
            If you have run Indian payroll, one of these four will tell you whether we have.
          </Lead>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {RULES.map((rule) => (
            <Card key={rule.claim} data-claim={rule.claim} className="p-6">
              <h3 className="font-display text-[17px] leading-snug font-bold text-balance text-n-900">
                {rule.title}
              </h3>
              <p className="mt-2.5 text-[14px] leading-6 text-pretty text-n-600">{rule.body}</p>
            </Card>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-accent-200 bg-accent-50 p-5">
          <p className="text-[14px] leading-6 text-n-700">
            <strong className="text-n-900">And the honest part.</strong> Twenty-three statutory
            documents generate — but only nineteen are returns. e-SHRAM, the Shram card, S&amp;E
            registration and Form 1 are preparation sheets, and say so on their face. Nothing here
            submits anything to a portal: every filing is a document a human uploads.{' '}
            <Link href="/product/compliance" className="font-semibold text-brand-700 underline underline-offset-4">
              The full list, named
            </Link>
          </p>
        </div>
      </Container>
    </Section>
  );
}

/* ── 9 · Security ─────────────────────────────────────────────────────── */

export function SecuritySection() {
  return (
    <Section tone="sunken">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-start lg:gap-14">
          <div>
            <Eyebrow>Security</Eyebrow>
            <SectionTitle className="mt-3">
              You are about to hand a stranger your salary data.
            </SectionTitle>
            <Lead className="mt-4">
              So here is exactly what is true today, and what is not. There are no badges on this
              page, because we have not earned any yet.
            </Lead>

            <ul className="mt-6 grid gap-4">
              <li data-claim="SEC-01" className="border-l-2 border-brand-300 pl-4">
                <p className="font-semibold text-n-900">Tenant isolation is structural</p>
                <p className="mt-1 text-[14px] leading-6 text-n-600">
                  <CountUp value={SECURITY.scopedModels.value} n={SECURITY.scopedModels.n} className="font-semibold text-n-800" />{' '}
                  models apply an organisation scope at the ORM layer and stamp the tenant on
                  create. Reading across tenants requires explicitly writing so — which makes it
                  greppable in review.
                </p>
              </li>
              <li data-claim="SEC-02" className="border-l-2 border-brand-300 pl-4">
                <p className="font-semibold text-n-900">And a test fails the build if it lapses</p>
                <p className="mt-1 text-[14px] leading-6 text-n-600">
                  A model that owns tenant data but forgets the scope breaks CI. Isolation is
                  enforced by the test suite, not by a reviewer remembering.
                </p>
              </li>
              <li data-claim="SEC-03" className="border-l-2 border-brand-300 pl-4">
                <p className="font-semibold text-n-900">Two-factor authentication, enforceable</p>
                <p className="mt-1 text-[14px] leading-6 text-n-600">
                  TOTP with recovery codes, a per-organisation policy of off, grace or enforced,
                  and mandatory enrolment for privileged roles.
                </p>
              </li>
              <li data-claim="SCM-02" className="border-l-2 border-brand-300 pl-4">
                <p className="font-semibold text-n-900">Deprovisioning actually removes access</p>
                <p className="mt-1 text-[14px] leading-6 text-n-600">
                  SAML lets somebody sign in; SCIM is the half that takes it away. Deactivating a
                  user <strong>revokes their API tokens</strong> rather than only setting a flag —
                  because a flag alone leaves a leaver’s existing token reading payroll on Monday,
                  which is the precise failure SCIM is bought to prevent.
                </p>
              </li>
              <li data-claim="CON-01" className="border-l-2 border-brand-300 pl-4">
                <p className="font-semibold text-n-900">Monitoring runs on notice and consent</p>
                <p className="mt-1 text-[14px] leading-6 text-n-600">
                  Screenshots, activity, geofenced punches and selfies all pass one gate. Notices
                  are versioned and never edited; consent is per capture type and can be
                  withdrawn. Under the DPDP Act that liability is the employer’s — so the tools
                  to manage it ship with the tracker.
                </p>
              </li>
            </ul>

            <div className="mt-6 rounded-xl border border-n-300 bg-card p-5">
              <p className="text-caption uppercase text-n-600">Not yet true</p>
              <p className="mt-2 text-[14px] leading-6 text-n-700">
                No SOC 2 report and no ISO 27001 certificate, and no published uptime or SLA.
                SAML single sign-on and SCIM provisioning do exist — but SCIM syncs people, not
                groups, so the roles somebody should get do not arrive with them. We would rather
                you read that here than discover it in procurement.
              </p>
            </div>

            <Button href="/security" tone="secondary" className="mt-6">
              Read the full security page
            </Button>
          </div>

          <Reveal>
            <ConsentNotice />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

/* ── 10 · Pricing preview ─────────────────────────────────────────────── */

export function PricingPreview() {
  const tracking = PLANS.filter((p) => p.family === 'tracking');
  const payroll = PLANS.filter((p) => p.family === 'payroll' && !p.contactOnly);

  const cheapestMonthlySeat = Math.min(...tracking.map((p) => p.monthlyPerSeat ?? 0));
  const cheapestYearlySeat = Math.min(
    ...tracking.map((p) => p.yearlyPerSeat ?? p.monthlyPerSeat ?? 0)
  );

  /*
   * The saving is DERIVED, never typed. "Save 10%" written by hand is a claim
   * that silently becomes false the day somebody edits a plan's yearly rate;
   * computed from the same two numbers the cards render, it cannot.
   */
  const savingPercent = Math.round(
    ((cheapestMonthlySeat - cheapestYearlySeat) / cheapestMonthlySeat) * 100
  );

  const cards: PriceCard[] = [
    {
      title: 'Tracking',
      monthly: cheapestMonthlySeat,
      yearly: cheapestYearlySeat,
      unit: '/ user / month',
      body: 'Evidence of work, attendance, leave and approvals. Priced per person, minimum 10.',
      points: ['Desktop tracker & browser extension', 'Attendance, leave, overtime', 'Projects, tasks and approvals'],
      highlighted: false,
    },
    {
      title: 'Payroll + Tracking',
      monthly: Math.min(...payroll.map((p) => p.basePrice ?? 0)),
      // Workspace plans are billed on `basePrice`, which monthlyTotal() resolves
      // without reference to the cycle. There is no annual rate to show, and
      // showing the monthly one twice would imply a discount that is not there.
      yearly: null,
      unit: '/ month',
      body: `Everything above, plus the payroll engine, statutory and filings. Includes 50 seats.`,
      points: ['Full payroll run lifecycle', 'PF, ESI, PT, TDS and 13 returns', 'Bank files, payslips and Form 16'],
      highlighted: true,
    },
    {
      title: 'Enterprise',
      monthly: null,
      yearly: null,
      unit: '',
      body: 'Custom integrations and commercial terms, agreed in writing rather than implied.',
      points: ['Custom integrations', 'Commercial terms by agreement'],
      highlighted: false,
    },
  ];

  return (
    <Section>
      <Container>
        <div className="max-w-2xl">
          <Eyebrow>Pricing</Eyebrow>
          <SectionTitle className="mt-3">Published, because most of this market hides it.</SectionTitle>
          <Lead className="mt-4">
            {TRIAL_DAYS}-day free trial, no credit card. Prices exclude {GST_PERCENT}% GST.
          </Lead>
        </div>

        <PricingCards cards={cards} savingLabel={`${savingPercent}% off per-seat plans, billed yearly.`} />

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button href="/pricing" size="lg">
            See full pricing & calculator
          </Button>
          <p className="text-[13.5px] text-n-600">
            Minimum {MIN_SEATS} seats on per-user plans. Workspace plans include 50.
          </p>
        </div>
      </Container>
    </Section>
  );
}

/* ── 11 · Switching timeline ──────────────────────────────────────────── */

const TIMELINE = [
  {
    when: 'Week 1',
    title: 'Your people and your structure',
    body: 'Import employees by CSV, with government ID and bank-detail validation running as you go. Define salary components and the structure they hang off — or start from a template and edit it.',
  },
  {
    when: 'Week 2',
    title: 'A parallel run against your current payroll',
    body: 'Process the month in CareVance without paying from it, then use the differences report against your existing output. Every component that disagrees is listed, with the reason.',
  },
  {
    when: 'Week 4',
    title: 'Go live, with the tracker following',
    body: 'Run payroll for real, generate the returns and the bank file. Roll the desktop tracker out afterwards — the payroll works without it, and it makes attendance better once it is on.',
  },
];

export function SwitchingSection() {
  return (
    <Section tone="sunken">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow>Switching</Eyebrow>
          <SectionTitle className="mt-3">
            The objection is never the product. It is the migration.
          </SectionTitle>
          <Lead className="mt-4">
            So here is the actual shape of it. The parallel run in week two is the part that
            matters — you should not have to trust a payroll engine you have not audited against
            your own numbers.
          </Lead>
        </div>

        {/* `relative` so StepArrows can overlay the row without affecting it. */}
        <div className="relative mt-10">
          <StepArrows />
          <ol className="grid gap-4 lg:grid-cols-3">
          {TIMELINE.map((step, i) => (
            <Card key={step.when} as="li" className="p-6">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-[11px] font-bold text-on-brand tnum">
                  {i + 1}
                </span>
                <p className="text-caption uppercase text-brand-700">{step.when}</p>
              </div>
              <h3 className="mt-3 font-display text-[17px] leading-snug font-bold text-balance text-n-900">
                {step.title}
              </h3>
              <p className="mt-2 text-[14px] leading-6 text-pretty text-n-600">{step.body}</p>
            </Card>
          ))}
          </ol>
        </div>
      </Container>
    </Section>
  );
}

/* ── 12 · FAQ ─────────────────────────────────────────────────────────── */

export const HOME_FAQS = [
  {
    q: 'Do I have to use the desktop tracker to run payroll?',
    a: 'No. Payroll works from attendance records however they were created — web check-in, mobile punch, or imported. The tracker makes the attendance better and gives you evidence behind every hour, but it is not a precondition for running payroll.',
  },
  {
    q: 'Is the employee monitoring legal, and how do employees feel about it?',
    a: 'Monitoring runs on notice and consent, enforced at a single gate every capture path passes through. Notices are versioned and never edited in place, consent is recorded per capture type, and it can be withdrawn. Under the DPDP Act the liability for collecting without notice falls on the employer, so those controls ship with the product rather than being left to you.',
  },
  {
    q: 'Which statutory documents can you actually produce?',
    a: 'Twenty-three, and nineteen of them are returns: PF ECR, Full ECR, ESI Challan, Form 24Q, PT Return, LWF Return, Bonus Forms C, D and E, Form 12BA, Form 16, Form 16 Annual, Form 19, Form 31, Form 2, Form 6 and Form 124. The other four — e-SHRAM, Shram card, S&E registration and Form 1 — are preparation sheets rather than returns, and say so on their face. Nothing auto-submits: every filing is a document a human uploads. Availability is resolved against the filesystem, so the product cannot advertise a return it is unable to write.',
  },
  {
    q: 'What is not built yet?',
    a: 'No public careers page — a recruiter records candidates rather than them applying themselves. No background-check vendor integration, so findings are entered by a human. SCIM syncs people but not groups, so roles do not sync. The roster has no drag-and-drop calendar. Biometric ingestion is ADMS push only. Accounting export produces a file to import rather than posting into Tally or Zoho over an API. No travel expense module, no company announcements, no engagement surveys or helpdesk. Chat polls rather than pushing in real time, and there is no i18n layer — English only.',
  },
  {
    q: 'How does pricing work if I have fewer than 50 employees?',
    a: `Per-user tracking plans start at a ${MIN_SEATS}-seat minimum and you pay for the seats you use. The payroll plans are workspace-priced with 50 seats included, which means below 50 people you are paying for seats you do not have — the calculator on the pricing page shows your real per-employee cost at your headcount rather than hiding it.`,
  },
  {
    q: 'Can I audit the payroll engine before trusting it with real money?',
    a: 'That is what the week-two parallel run is for. Process a month in CareVance without paying from it, then use the differences report against your current provider’s output. Every component that disagrees is listed with the reason it moved.',
  },
] as const;

export function FaqSection() {
  return (
    <Section>
      <Container width="prose">
        <Eyebrow>Questions</Eyebrow>
        <SectionTitle className="mt-3">Six real objections.</SectionTitle>

        <div className="mt-8 divide-y divide-n-200 border-y border-n-200">
          {HOME_FAQS.map((faq) => (
            /*
             * Native <details>. Accessible by default, keyboard-operable by
             * default, and costs zero JavaScript — a hand-rolled accordion here
             * would be worse in every measurable way.
             *
             * `name` makes it an EXCLUSIVE accordion natively: opening one
             * closes the others, which the brief asks for, with no state to
             * hold. `faq-item` is the hook for the open/close animation defined
             * in globals.css — also CSS, also zero JavaScript.
             */
            <details key={faq.q} name="home-faq" className="faq-item group py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-left font-display text-[16.5px] font-bold text-n-900 marker:hidden">
                {faq.q}
                <svg
                  viewBox="0 0 16 16"
                  className="mt-1 h-4 w-4 shrink-0 text-n-500 transition-transform duration-200 group-open:rotate-45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M8 3.5v9M3.5 8h9" />
                </svg>
              </summary>
              <p className="mt-3 text-[14.5px] leading-7 text-pretty text-n-600">{faq.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </Section>
  );
}

/* ── 13 · Final CTA ───────────────────────────────────────────────────── */

export function FinalCta() {
  return (
    <Section tone="deep" className="text-white">
      <Container width="prose" className="text-center">
        <h2 className="font-display text-title text-balance">
          See a real payroll run, end to end.
        </h2>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-pretty text-white/80">
          Twenty minutes with someone who can answer engine questions, or two minutes on your
          own first. Both paths land in the same place.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button href={CTA.demo.href} tone="inverse" size="lg">
            {CTA.demo.label}
          </Button>
          <Button href={CTA.tour.href} tone="inverse-secondary" size="lg">
            {CTA.tour.label}
          </Button>
        </div>
        <p className="mt-6 text-[13px] text-white/80">
          {TRIAL_DAYS}-day free trial · no credit card · {SCALE.apps.value} apps included
        </p>
      </Container>
    </Section>
  );
}
