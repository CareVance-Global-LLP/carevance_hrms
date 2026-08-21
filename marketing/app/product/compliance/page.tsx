import type { Metadata } from 'next';
import Link from 'next/link';
import { breadcrumbSchema, faqSchema, JsonLd } from '@/lib/schema';
import { PT_STATES, PT_LEVYING_COUNT, PT_NIL_COUNT } from '@/lib/pt-states';
import { C } from '@/lib/calc';
import {
  Card,
  Container,
  Eyebrow,
  Lead,
  Section,
  SectionTitle,
} from '@/components/ui/primitives';
import { ProductHero, FeatureBlock, ProductCta } from '@/components/product/PageParts';
import { StatutoryBreakdown, FilingsList, EmployerCost } from '@/components/product/screens';
import { Panel } from '@/components/product/Frame';

export const metadata: Metadata = {
  title: 'Compliance & filings',
  description: `PF at the ₹15,000 ceiling, ESI with contribution-period lock-in, professional tax across all ${PT_STATES.length} states and union territories, cumulative TDS on both regimes — and 13 statutory returns in real EPFO and NSDL formats.`,
  alternates: { canonical: '/product/compliance' },
};

/** The 13 that generate. Named, because a count alone is not checkable. */
const GENERATES = [
  { label: 'PF ECR', note: 'EPFO electronic challan-cum-return' },
  { label: 'Full ECR', note: 'complete member-wise return' },
  { label: 'ESI Challan', note: 'ESIC contribution challan' },
  { label: 'Form 24Q', note: 'quarterly TDS return, NSDL FVU format' },
  { label: 'Form 16', note: 'annual salary certificate' },
  { label: 'Form 16 (Annual)', note: 'consolidated across the year' },
  { label: 'Form 12BA', note: 'perquisites statement' },
  { label: 'PT Return', note: 'state professional tax' },
  { label: 'LWF Return', note: 'labour welfare fund' },
  { label: 'Bonus — Form C', note: 'Payment of Bonus Act' },
  { label: 'Bonus — Form D', note: 'Payment of Bonus Act' },
  { label: 'Bonus — Form E', note: 'Payment of Bonus Act' },
  { label: 'Bonus (combined)', note: 'C, D and E together' },
];

/** The 10 that do not. Named too — that is the whole point. */
const UNAVAILABLE = [
  'Form 1', 'Form 2', 'Form 6', 'Form 19', 'Form 31', 'Form 124',
  'e-SHRAM registration', 'UAN activation', 'S&E registration', 'Shram card',
];

const FAQS = [
  {
    q: 'How many statutory returns can CareVance actually produce?',
    a: 'Thirteen. Twenty-three generator types are registered, and ten of them report as unavailable because their statutory templates have not been written. Availability is resolved against the filesystem rather than a hand-kept flag, so the product cannot advertise a return it is unable to write.',
  },
  {
    q: 'What is the ESI contribution-period rule?',
    a: 'Coverage is fixed for a whole contribution period — 1 April to 30 September, and 1 October to 31 March. An employee covered at the start of a period stays covered until it ends, even if a raise takes their wages above ₹21,000 partway through, and contributions continue on the higher wages. Testing gross against the ceiling month by month under-collects and leaves the ECR return disagreeing with what was actually deducted.',
  },
  {
    q: 'Do you cover professional tax for every state?',
    a: `All ${PT_STATES.length} states and union territories are in the table. ${PT_LEVYING_COUNT} levy professional tax; ${PT_NIL_COUNT} levy none, and those correctly return ₹0. An unset state never falls back to a default — inventing a tax is worse than missing one.`,
  },
  {
    q: 'What happens if my organisation has not set a PAN or TAN yet?',
    a: 'The filing reports filing_ready: false and names what is missing. It does not emit a placeholder like PANINVALID and report success, which is how an invalid return reaches a portal and comes back rejected weeks later.',
  },
  {
    q: 'If one filing generator fails, does the whole batch fail?',
    a: 'No. Each generator is attempted independently and the batch returns both the filings it produced and the failures by name. It used to be an unguarded sequence, which meant the first throw ended the run after PF ECR, ESI, 24Q and 12BA had already been written — leaving a 500 and no report.',
  },
] as const;

export default function CompliancePage() {
  return (
    <>
      <JsonLd schema={faqSchema(FAQS.map((f) => ({ q: f.q, a: f.a })))} />
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Product', href: '/product' },
          { label: 'Compliance', href: '/product/compliance' },
        ])}
      />

      <ProductHero
        eyebrow="Compliance & filings"
        title="India-deep, not India-available."
        lede="Every HRMS sold in this country says “statutory compliance”. The phrase is worth nothing on its own, so this page names the rules instead — including the two or three that separate a payroll engine built for India from one that was translated into it."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <StatutoryBreakdown />
          <EmployerCost />
          <FilingsList />
        </div>
      </ProductHero>

      {/* ── The rules ───────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>The rules, by name</Eyebrow>
            <SectionTitle className="mt-3">Four you can test us on.</SectionTitle>
            <Lead className="mt-4">
              If you have run Indian payroll, one of these will tell you whether we have.
            </Lead>
          </div>

          <div className="mt-12 grid gap-16">
            <FeatureBlock
              claim="STA-03"
              eyebrow="ESI"
              title="Coverage is locked for the contribution period."
              body="April to September, and October to March. Someone covered when a period opened stays covered until it closes, even if a raise takes them past ₹21,000 in month three — and contributions continue on the higher wages for the rest of the period. Test a payroll tool on exactly this: most drop the employee the instant they cross, which under-collects and leaves the ECR disagreeing with the payslip."
              points={[
                { text: 'Threshold ₹21,000 gross — 0.75% employee, 3.25% employer', claim: 'STA-02' },
                { text: 'Prior contribution within the period keeps the employee covered', claim: 'STA-03' },
                { text: 'The return and the deduction cannot disagree', claim: 'STA-03' },
              ]}
              screen={
                <Panel label="ESI contribution period">
                  <div className="p-4">
                    <p className="text-[12.5px] leading-5 text-n-700">
                      Period <strong>1 Apr – 30 Sep</strong>. Covered at the start on ₹19,400 gross.
                    </p>
                    <ul className="mt-3 grid gap-1.5 text-[12px]">
                      {[
                        { m: 'April', g: '₹19,400', c: true },
                        { m: 'May', g: '₹19,400', c: true },
                        { m: 'June — raise to ₹24,000', g: '₹24,000', c: true, raise: true },
                        { m: 'July', g: '₹24,000', c: true },
                        { m: 'August', g: '₹24,000', c: true },
                        { m: 'September', g: '₹24,000', c: true },
                        { m: 'October — new period', g: '₹24,000', c: false },
                      ].map((r) => (
                        <li
                          key={r.m}
                          className="flex items-center justify-between gap-2 rounded-md border border-n-100 px-2.5 py-1.5"
                        >
                          <span className={r.raise ? 'font-semibold text-n-900' : 'text-n-600'}>
                            {r.m}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-n-600 tnum">{r.g}</span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                r.c
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-n-100 text-n-600'
                              }`}
                            >
                              {r.c ? 'covered' : 'exits'}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 border-t border-n-200 pt-2.5 text-[11.5px] leading-4 text-n-600">
                      The raise in June does not end coverage. The period does, on 30 September.
                    </p>
                  </div>
                </Panel>
              }
            />

            <FeatureBlock
              claim="STA-04"
              flip
              eyebrow="Professional tax"
              title={`${PT_STATES.length} states and UTs — and ${PT_NIL_COUNT} of them levy nothing.`}
              body="Professional tax is levied by states, so there is no national rate and no single slab table. The part most systems get wrong is not the arithmetic — it is what happens when a state is unset or has no tax. Defaulting to a neighbour deducts a tax that does not exist and files a return nobody asked for."
              points={[
                { text: `${PT_LEVYING_COUNT} states levy PT; ${PT_NIL_COUNT} return ₹0, correctly`, claim: 'STA-04' },
                { text: 'Month-aware — Maharashtra’s ₹300 February is modelled', claim: 'STA-04' },
                { text: 'The February rate applies to the top band only', claim: 'STA-04' },
                { text: 'Annual limits respect the ₹2,500 constitutional ceiling', claim: 'STA-04' },
              ]}
              screen={
                <Card className="p-5">
                  <p className="text-caption uppercase text-n-600">Try it yourself</p>
                  <p className="mt-2 text-[14px] leading-6 text-n-600">
                    The professional tax calculator on this site reads the same table the payroll
                    engine does — generated from it by a script, not transcribed.
                  </p>
                  <Link
                    href="/tools/professional-tax-by-state"
                    className="mt-4 inline-flex text-[13.5px] font-semibold text-brand-700 underline-offset-4 hover:underline"
                  >
                    Open the professional tax calculator →
                  </Link>
                </Card>
              }
              stat={{ value: `${PT_NIL_COUNT}`, label: 'states and UTs where ₹0 is the correct answer' }}
            />

            <FeatureBlock
              claim="STA-01"
              eyebrow="Provident fund"
              title="The ceiling, and the split that appears on the return."
              body={`Twelve percent each side of a ₹${C.PF_WAGE_CAP.toLocaleString('en-IN')} wage ceiling. The employer's half is not one number: it divides into the pension scheme at 8.33% and the provident fund at 3.67%, and the ECR return needs that split rather than the total.`}
              points={[
                { text: 'EPS 8.33% / EPF 3.67% split computed, not assumed', claim: 'STA-01' },
                { text: 'Above-ceiling contribution supported where an employer opts in', claim: 'STA-01' },
                { text: 'VPF handled as a separate voluntary component', claim: 'STA-01' },
                { text: 'Gratuity provision at 4.81%, with the settlement path guarded', claim: 'STA-07' },
              ]}
              screen={<EmployerCost />}
            />

            <FeatureBlock
              claim="STA-06"
              flip
              eyebrow="Income tax"
              title="Cumulative TDS, both regimes, with marginal relief."
              body="TDS is computed cumulatively — tax for the year to date, less what has already been deducted — rather than as a flat twelfth of an annual guess. That is why submitting proofs in December changes your February deduction instead of leaving a shock in March."
              points={[
                { text: 'Old and new regime, FY-keyed slabs, 4% cess', claim: 'STA-05' },
                { text: 'Section 87A assessed on taxable income, not gross', claim: 'STA-05' },
                { text: 'Marginal relief above the ₹12,00,000 threshold', claim: 'STA-05' },
                { text: 'Surcharge bands with contiguous boundaries — no income falls between', claim: 'STA-05' },
              ]}
              screen={<StatutoryBreakdown />}
            />
          </div>
        </Container>
      </Section>

      {/* ── The honest filing list ──────────────────────────────────── */}
      <Section>
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Filings</Eyebrow>
            <SectionTitle className="mt-3">
              Thirteen generate. Ten do not. Both lists are here.
            </SectionTitle>
            <Lead className="mt-4">
              Availability is resolved against the filesystem rather than a flag someone maintains
              by hand, so the product physically cannot advertise a return it is unable to write.
              Writing the missing templates is real statutory work, not a configuration step.
            </Lead>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card className="p-6">
              <p className="flex items-center gap-2 text-caption uppercase text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                Generates today — {GENERATES.length}
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {GENERATES.map((f) => (
                  <li key={f.label} className="text-[13.5px] leading-5">
                    <span className="font-semibold text-n-900">{f.label}</span>
                    <span className="block text-[11.5px] text-n-600">{f.note}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="border-n-300 p-6">
              <p className="flex items-center gap-2 text-caption uppercase text-n-600">
                <span className="h-1.5 w-1.5 rounded-full bg-n-400" aria-hidden="true" />
                Registered but unavailable — {UNAVAILABLE.length}
              </p>
              <ul className="mt-4 grid gap-1.5">
                {UNAVAILABLE.map((f) => (
                  <li key={f} className="text-[13.5px] text-n-600">
                    {f}
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-n-200 pt-3 text-[12px] leading-5 text-n-600">
                These report as unavailable with a stated reason rather than failing when you click.
                They are listed rather than hidden, because the product must be able to say{' '}
                <em>why</em> they are missing.
              </p>
            </Card>
          </div>
        </Container>
      </Section>

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container width="prose">
          <SectionTitle>Compliance questions</SectionTitle>
          <div className="mt-6 divide-y divide-n-200 border-y border-n-200">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-display text-[16px] font-bold text-n-900">
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

      <ProductCta
        title="Bring a month we can get wrong."
        body="The fastest way to evaluate a statutory engine is to hand it the edge case you already know the answer to. We would rather you did that than watch a slide."
      />
    </>
  );
}
