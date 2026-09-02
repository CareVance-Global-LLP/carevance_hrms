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
import { WorkingTimeBreaches, JournalPreview } from '@/components/product/screens-modules';
import { Panel } from '@/components/product/Frame';

export const metadata: Metadata = {
  title: 'Compliance & filings',
  description: `PF at the ₹15,000 ceiling, ESI with contribution-period lock-in, professional tax across all ${PT_STATES.length} states and union territories, cumulative TDS on both regimes — and 13 statutory returns in real EPFO and NSDL formats.`,
  alternates: { canonical: '/product/compliance' },
};

/**
 * The 19 that are returns, named — because a count alone is not checkable.
 *
 * An earlier version of this page said 13 generated and 10 were unavailable.
 * Both numbers were wrong: the ten missing blade templates have since been
 * written. The honest distinction is no longer available-vs-unavailable, it is
 * return-vs-preparation-sheet. See PRODUCT_TRUTH.md FIL-06.
 */
const RETURNS = [
  { label: 'PF ECR', note: 'EPFO electronic challan-cum-return' },
  { label: 'Full ECR', note: 'complete member-wise return' },
  { label: 'ESI Challan', note: 'ESIC contribution challan' },
  { label: 'Form 24Q', note: 'quarterly TDS return, NSDL FVU format' },
  { label: 'Form 16', note: 'annual salary certificate' },
  { label: 'Form 16 (Annual)', note: 'consolidated across the year' },
  { label: 'Form 12BA', note: 'perquisites statement' },
  { label: 'PT Return', note: 'state professional tax' },
  { label: 'LWF Return', note: 'labour welfare fund' },
  { label: 'Form 19', note: 'EPF final settlement claim' },
  { label: 'Form 31', note: 'EPF partial withdrawal' },
  { label: 'Form 2', note: 'EPF/EPS nomination and declaration' },
  { label: 'Form 6', note: 'EPS revised nomination' },
  { label: 'Form 124', note: 'LWF statement' },
  { label: 'UAN Activation', note: 'member declaration' },
  { label: 'Bonus — Form C', note: 'Payment of Bonus Act' },
  { label: 'Bonus — Form D', note: 'Payment of Bonus Act' },
  { label: 'Bonus — Form E', note: 'Payment of Bonus Act' },
  { label: 'Bonus (combined)', note: 'C, D and E together' },
];

/** The 4 that generate output but are NOT returns. Named, because that matters. */
const PREPARATION_SHEETS = [
  { label: 'e-SHRAM registration', why: 'e-SHRAM covers unorganised workers, so most of a PF-deducting payroll is ineligible.' },
  { label: 'Shram card', why: 'A worksheet for the state portal, not a return in itself.' },
  { label: 'S&E registration', why: 'Shops & Establishments registration is state legislation, filed on each state’s own form.' },
  { label: 'Form 1', why: 'A preparation sheet rather than a submission.' },
];

const FAQS = [
  {
    q: 'How many statutory documents can CareVance actually produce?',
    a: 'Twenty-three generate output, and nineteen of those are returns. The other four — e-SHRAM registration, the Shram card, S&E registration and Form 1 — are preparation sheets rather than returns, and the templates say so on their face. Availability is resolved against the filesystem rather than a hand-kept flag, so the product cannot advertise a return it is unable to write.',
  },
  {
    q: 'Does CareVance file the returns for me?',
    a: 'No. Every filing is a document you download and upload to the relevant portal. Nothing here submits anything on your behalf, and we would rather say that plainly than let "compliance automation" imply otherwise.',
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
              claim="SWT-01"
              flip
              eyebrow="Working-hour law"
              title="Limits are properties of the premises, not a policy somebody configured."
              body="How long somebody may work, and what overtime is worth, are set by the Factories Act and the state Shops & Establishments Acts. So they live on the legal entity — with the provision each number comes from — rather than as literals scattered through the engines that apply them. When a state amends a limit, one file changes."
              points={[
                { text: 'An exemption is READ from the entity, never inferred from an address: s.55 allows six hours instead of five only by written order of the Chief Inspector, so a Gujarat factory without that order is still on five', claim: 'SWT-03' },
                { text: 'S&E limits are deliberately thinner — the Acts genuinely differ by state, so a daily ceiling is left null rather than guessed. A compliance screen that cries wolf gets switched off', claim: 'SWT-04' },
                { text: 'The overtime floor is computed always and applied only on request: raising a live payroll rate because somebody deployed a release is not the engine\u2019s decision', claim: 'SWT-07' },
                { text: 'The register measures excess over nine hours a day or forty-eight a week — s.59 — not excess over the rostered shift', claim: 'SWT-08' },
                { text: 'A rest interval is one qualifying break, not the sum of several: two fifteen-minute teas are not a half hour under s.55', claim: 'SWT-09' },
              ]}
              screen={<WorkingTimeBreaches />}
            />

            <FeatureBlock
              claim="SWT-06"
              eyebrow="Honesty in a report"
              title="&ldquo;Unregulated&rdquo; means unassessed, not compliant."
              body="An employee with no legal entity assigned has no limits to be measured against. Folding those people into the clear column produces a green tick that means nothing — and nobody re-checks a clean compliance report. So they are counted separately, by name, as not assessed."
              points={[
                { text: 'The breach list returns is_regulated: false and an empty array, never a pass', claim: 'SWT-06' },
                { text: 'The register prices ASSESSED hours, not approved ones — pricing only approved rows returns zero for everything pending, which reads as overtime worked and nothing owed', claim: 'SWT-10' },
                { text: 'An employee with no annual CTC yields a null amount, never a zero, and the totals surface how many rows could not be priced', claim: 'SWT-10' },
              ]}
              screen={<WorkingTimeBreaches />}
            />

            <FeatureBlock
              claim="ENT-01"
              flip
              eyebrow="Legal entities"
              title="One organisation, several registered companies."
              body="Each legal entity carries its own PAN, TAN, PF and ESI codes, plus its establishment type and any recorded exemption. A resolver decides which entity an employee files under, defaulting to the primary — and filings generate per entity rather than per workspace."
              points={[
                { text: 'Filings generate per entity, resolved per employee', claim: 'FIL-07' },
                { text: 'Establishment type and exemptions drive the working-hour assessment', claim: 'ENT-04' },
                { text: 'Configured under Settings, Legal entities', claim: 'ENT-05' },
              ]}
              screen={
                <Panel label="Legal entities">
                  <ul className="divide-y divide-n-100">
                    {[
                      { name: 'CareVance Global LLP', type: 'Head office \u00b7 S&E', primary: true },
                      { name: 'CareVance Manufacturing Pvt Ltd', type: 'Factory \u00b7 Maharashtra', primary: false },
                    ].map((e) => (
                      <li key={e.name} className="px-4 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[12.5px] font-semibold text-n-900">
                            {e.name}
                          </span>
                          {e.primary && (
                            <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800">
                              primary
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-n-600">
                          {e.type} &middot; own PAN, TAN, PF and ESI codes
                        </p>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-n-200 bg-sunken px-4 py-2 text-[11px] leading-4 text-n-600">
                    The factory is on Factories Act limits; the head office is on state S&amp;E
                    limits. Same workspace, different statute.
                  </p>
                </Panel>
              }
            />

            <FeatureBlock
              claim="ACC-01"
              eyebrow="Accounting"
              title="The journal balances exactly, or nothing is produced."
              body="A payroll run posts as double entry. Debits equal credits to the paisa or the export refuses — because an unbalanced journal is rejected by every accounting system worth the name, and the ones that do not reject it import half, which is considerably worse than a refusal somebody can act on."
              points={[
                { text: 'An unmapped component refuses the export and is NAMED — never a suspense account, never omitted', claim: 'ACC-02' },
                { text: 'PF and ESI payable carry both halves in one credit line, so it reconciles against the single challan that gets paid', claim: 'ACC-04' },
                { text: 'Computed in bcmath and rounded once: a float sum drifts by a paisa across a few hundred employees, and a paisa is the difference between balanced and rejected', claim: 'ACC-03' },
                { text: 'Tally sign convention is backwards — a debit is a negative amount. Get it the intuitive way round and the voucher still imports, it just posts every salary as income', claim: 'ACC-05' },
                { text: 'Zoho Books gets a separate exporter rather than a flag, because the two formats disagree about something fundamental', claim: 'ACC-07' },
              ]}
              screen={<JournalPreview />}
              flip
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
              Twenty-three documents. Nineteen of them are returns.
            </SectionTitle>
            <Lead className="mt-4">
              Availability is resolved against the filesystem rather than a flag someone maintains
              by hand, so the product physically cannot advertise a return it is unable to write.
              The distinction worth caring about is not whether a document generates — they all do —
              but whether it is a <em>return</em>.
            </Lead>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card className="p-6">
              <p className="flex items-center gap-2 text-caption uppercase text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                Statutory returns — {RETURNS.length}
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {RETURNS.map((f) => (
                  <li key={f.label} className="text-[13.5px] leading-5">
                    <span className="font-semibold text-n-900">{f.label}</span>
                    <span className="block text-[11.5px] text-n-600">{f.note}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="border-accent-200 bg-accent-50 p-6">
              <p className="flex items-center gap-2 text-caption uppercase text-accent-700">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-400" aria-hidden="true" />
                Preparation sheets, not returns — {PREPARATION_SHEETS.length}
              </p>
              <ul className="mt-4 grid gap-3">
                {PREPARATION_SHEETS.map((f) => (
                  <li key={f.label} className="text-[13.5px] leading-5">
                    <span className="font-semibold text-n-900">{f.label}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-4 text-n-600">{f.why}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-accent-200/70 pt-3 text-[12px] leading-5 text-n-700">
                These produce a document, and each says on its face that it is a preparation sheet.
                Calling them returns would be the easiest four numbers on this page to inflate.
              </p>
            </Card>
          </div>

          <div className="mt-6 rounded-xl border border-n-300 bg-card p-5">
            <p className="text-[14px] leading-6 text-n-700">
              <strong className="text-n-900">And nothing here submits anything.</strong> Every
              filing is a file you download and upload to the relevant portal. There is no
              integration with EPFO, ESIC, NSDL or any state portal, and “compliance automation”
              should not be read as implying one.
            </p>
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
