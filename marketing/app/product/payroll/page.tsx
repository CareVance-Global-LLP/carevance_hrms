import type { Metadata } from 'next';
import { breadcrumbSchema, JsonLd } from '@/lib/schema';
import { Container, Eyebrow, Lead, Section, SectionTitle } from '@/components/ui/primitives';
import {
  ProductHero,
  FeatureBlock,
  NotBuiltNote,
  ProductCta,
} from '@/components/product/PageParts';
import {
  RunLifecycle,
  PayrollRun,
  Payslip,
  EmployerCost,
  OverrideRegister,
  OverrideRefusal,
  DifferencesReport,
  FilingsList,
  StatutoryBreakdown,
} from '@/components/product/screens';

export const metadata: Metadata = {
  title: 'Payroll',
  description:
    'Indian payroll with the arithmetic to prove it: a governed run lifecycle, salary structures built from formula and slab components, overrides that refuse impossible values at entry, and detective reports before the money moves.',
  alternates: { canonical: '/product/payroll' },
};

const NOT_CLAIMED = [
  'Payroll for any jurisdiction outside India',
  'Filing on your behalf — every return is a file you upload yourself',
  'A live accounting API push; Tally and Zoho get a file to import',
  'Four of the 23 statutory documents are preparation sheets, not returns',
];

export default function PayrollPage() {
  return (
    <>
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Product', href: '/product' },
          { label: 'Payroll', href: '/product/payroll' },
        ])}
      />

      <ProductHero
        eyebrow="Payroll"
        title="Indian payroll, and the arithmetic to prove it."
        lede="Most payroll software will give you a number. The question that decides whether you trust it is whether the number can explain itself — which component moved, by how much, because of which rule, approved by whom. That is what this engine is built around."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid gap-4">
            <RunLifecycle />
            <StatutoryBreakdown />
          </div>
          <PayrollRun />
        </div>
      </ProductHero>

      {/* ── Lifecycle ───────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>The run</Eyebrow>
            <SectionTitle className="mt-3">
              Five states, each one stamped with who and when.
            </SectionTitle>
            <Lead className="mt-4">
              A payroll run moves draft → locked → approved → released → disbursed. Every
              transition records the actor and the timestamp, and a closed run cannot be written to
              casually — there is a guard, and it names itself in the stack trace when something
              tries.
            </Lead>
          </div>

          <div className="mt-12 grid gap-16">
            <FeatureBlock
              claim="PAY-05"
              eyebrow="Processing"
              title="Queued, pollable, and refused if you start it twice."
              body="Processing a run does not block a request for four minutes. It returns immediately with a progress handle, and the client polls until it finishes. Start a second run while one is in flight and you get a 409 rather than a queue position — two workers walking the same list would race to create the same payroll item."
              points={[
                { text: 'Returns 202 with a progress handle, not a four-minute request', claim: 'PAY-05' },
                { text: 'A retry is deliberately not attempted — a partial run must not be re-entered', claim: 'PAY-05' },
                { text: 'Failures are recorded on the run for a human, not swallowed', claim: 'PAY-05' },
              ]}
              screen={<RunLifecycle />}
              stat={{ value: '409', label: 'what a concurrent second start returns, rather than racing' }}
            />

            <FeatureBlock
              claim="HR-10"
              eyebrow="Effective dating"
              title="A mid-month revision blends. A back-dated one diffs against a real prior rate."
              body="Compensation is a timeline, not a column. CompensationTimeline resolves what somebody earned on any given day from their accepted revision letters, and the run asks it for a blended figure rather than assuming the current CTC applied all month. So arrears across a revision are computed, not approximated."
              points={[
                { text: 'Revision letters are accepted or rejected by the employee', claim: 'HR-07' },
                { text: 'A back-dated revision diffs against the rate that was actually in force', claim: 'HR-10' },
                { text: 'Multiple legal entities, each with its own PAN, TAN, PF and ESI codes', claim: 'ENT-01' },
                { text: 'Filings generate per entity, resolved per employee', claim: 'FIL-07' },
              ]}
              screen={<DifferencesReport />}
              flip
            />

            <FeatureBlock
              claim="PAY-01"
              eyebrow="Structure"
              title="CTC in, components out, and the total balances to the paisa."
              body="Salary structures are built from formula, slab and lookup components, with CTC range bands and pay groups on top. One component is designated the residual and absorbs whatever is left, so the sum returns to CTC exactly rather than approximately."
              points={[
                { text: 'Formula components are validated before they are saved', claim: 'PAY-03' },
                { text: 'Employer PF and the gratuity provision sit inside the CTC envelope', claim: 'STA-01' },
                { text: 'Per-department templates, pay groups and CTC bands', claim: 'PAY-03' },
              ]}
              screen={<EmployerCost />}
              stat={{ value: '₹1,20,000', label: 'gross plus employer cost, back to monthly CTC exactly' }}
            />
          </div>
        </Container>
      </Section>

      {/* ── Overrides ───────────────────────────────────────────────── */}
      <Section>
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Governed overrides</Eyebrow>
            <SectionTitle className="mt-3">
              The module that made this product worth building.
            </SectionTitle>
            <Lead className="mt-4">
              Every payroll system lets you override a component. The interesting question is what
              happens next — whether the system tells you what the change actually cost, and what
              it does when the change cannot work.
            </Lead>
          </div>

          <div className="mt-12 grid gap-16">
            <FeatureBlock
              claim="OVR-02"
              eyebrow="Amplification"
              title="Raising Basic by ₹1 costs ₹1.668. The screen says so before you commit."
              body="HRA is derived from Basic. Employer PF is computed on it. The gratuity provision is 4.81% of it. All three sit inside the CTC envelope, so four quantities move together — and an admin who types ‘Basic 60,000’ expecting Special Allowance to drop by ₹12,000 watches it drop by ₹20,016. No product in this market shows that, which is exactly why an override screen needs a preview rather than a plain input."
              points={[
                { text: 'The preview names the absorbing component and its before and after', claim: 'OVR-02' },
                { text: 'The residual role only ever falls to a taxable component', claim: 'OVR-03' },
                { text: 'Two components claiming the residual is a configuration error, not a coin flip', claim: 'OVR-04' },
              ]}
              screen={<OverrideRegister />}
            />

            <FeatureBlock
              claim="OVR-01"
              flip
              eyebrow="Refusal"
              title="When it cannot balance, it says no — and names the maximum."
              body="A negative residual is not a warning to be dismissed; it is an impossible structure. Rather than accept the value and fail at finalisation weeks later, the balancer refuses at entry and tells you the largest value that would work, to the paisa, while you are still looking at the screen and the fix is cheap."
              points={[
                { text: 'Refused at entry, with max_permitted computed and returned', claim: 'OVR-01' },
                { text: 'Maker-checker: proposed by one person, approved by another', claim: 'OVR-05' },
                { text: 'Append-only audit trail per override', claim: 'OVR-06' },
                { text: 'CSV export, template, validate, then commit — never commit-and-hope', claim: 'OVR-07' },
              ]}
              screen={<OverrideRefusal />}
            />
          </div>
        </Container>
      </Section>

      {/* ── Detective reports ───────────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Before the money moves</Eyebrow>
            <SectionTitle className="mt-3">Four reports that find the mistake.</SectionTitle>
            <Lead className="mt-4">
              Payroll errors are cheap to fix before disbursement and expensive after. These run
              against a run rather than after it.
            </Lead>
          </div>

          <div className="mt-12">
            <FeatureBlock
              claim="CTL-01"
              title="The differences report names what moved, and what moved it."
              body="Compare two runs by item, by employee, or consolidated. Every component that changed is listed with the amount and the reason — including which override caused it. This is the report that makes a parallel run against your current provider a two-hour job rather than a fortnight."
              points={[
                { text: 'Differences: item-wise, employee-wise and consolidated', claim: 'CTL-01' },
                { text: 'Negative-cost report — employees whose run produced an impossible figure', claim: 'CTL-02' },
                { text: 'Duplicate detection within a run', claim: 'CTL-03' },
                { text: 'Reconciliation between two runs', claim: 'CTL-04' },
              ]}
              screen={<DifferencesReport />}
            />
          </div>
        </Container>
      </Section>

      {/* ── Statutory & money ───────────────────────────────────────── */}
      <Section>
        <Container>
          <div className="grid gap-16">
            <FeatureBlock
              claim="FIL-01"
              flip
              eyebrow="Filings & disbursement"
              title="Real EPFO and NSDL formats, and a bank file that never drops anyone."
              body="Thirteen statutory outputs generate today in the formats the portals actually accept. The NEFT/RTGS batch records every line, and people who cannot be paid — missing bank details, a stop-payment flag — come back as named exclusions rather than quietly vanishing from a total that then does not reconcile."
              points={[
                { text: 'Unpayable employees returned as exclusions, never silently dropped', claim: 'BNK-02' },
                { text: 'The bank’s UTR is the only reference reconciliation trusts', claim: 'BNK-03' },
                { text: 'Reversals and stop-payment flags are first-class', claim: 'BNK-04' },
                { text: 'A filing reports not-ready when PAN or TAN is missing', claim: 'FIL-04' },
              ]}
              screen={<FilingsList />}
            />

            <FeatureBlock
              claim="PAY-04"
              eyebrow="The payslip"
              title="The end of the chain is the same record as the start."
              body="Every payroll item is versioned. A figure on a payslip traces back through the version that produced it, the override that moved it, the person who approved that override, and the attendance the run was computed from — without leaving the system."
              points={[
                { text: 'Payslip PDFs, YTD history and Form 16', claim: 'FIL-01' },
                { text: 'Employees reach their own figures only, through a tested allow-list', claim: 'TAX-05' },
                { text: 'Negative net pay is surfaced for validation, never clamped to zero', claim: 'PAY-08' },
              ]}
              screen={<Payslip />}
            />
          </div>

          <div className="mt-16">
            <NotBuiltNote items={NOT_CLAIMED}>
              The payroll engine is the most complete part of this product, and it still has edges.
              These are the ones worth knowing before an evaluation.
            </NotBuiltNote>
          </div>
        </Container>
      </Section>

      <ProductCta
        title="Run a parallel month against your current provider."
        body="Process a real month in CareVance without paying from it, then read the differences report. That is a more useful evaluation than any demo, and we would rather you did it."
      />
    </>
  );
}
