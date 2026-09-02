import type { Metadata } from 'next';
import { breadcrumbSchema, faqSchema, JsonLd } from '@/lib/schema';
import { Container, Eyebrow, Lead, Section, SectionTitle } from '@/components/ui/primitives';
import {
  ProductHero,
  FeatureBlock,
  NotBuiltNote,
  ProductCta,
} from '@/components/product/PageParts';
import { LeaveLedger, LeaveTypes } from '@/components/product/screens-modules';
import { MobileApprovals } from '@/components/product/screens';
import { Panel } from '@/components/product/Frame';

export const metadata: Metadata = {
  title: 'Leave',
  description:
    'Per-type accrual with mid-year pro-rating and separate probation rates, a balance that is a dated ledger rather than a counter, and a year end written as rows so “5 carried, 2 expired” is sayable.',
  alternates: { canonical: '/product/leave' },
};

const NOT_CLAIMED = [
  'Statutory leave minimums enforced per state — quotas are yours to configure',
  'Automatic public-holiday import — the calendar is entered per organisation',
  'Compensatory-off auto-grant from overtime; comp-off is tracked, not derived',
];

const FAQS = [
  {
    q: 'How is a leave balance calculated?',
    a: 'It is the sum of a dated ledger, never a stored counter. Every accrual, every day taken, every carry-forward and every expiry is a signed row with a date. So “why is my balance 8.5” expands into the six rows that produced it, rather than resolving to a number nobody can explain.',
  },
  {
    q: 'What happens to somebody who joins in November?',
    a: 'They get a pro-rated first period, not a full year. The rules apply in a specific order — which periods the leave year contains, whether the person was employed for a given period, what a partial first period is worth against a joining-cutoff day, then what the per-period rate is. Getting that order wrong is exactly how a November joiner ends up with a full year’s entitlement.',
  },
  {
    q: 'Can accrual run on a different cadence per leave type?',
    a: 'Yes — annual, half-yearly, quarterly or monthly, set per type. Accrual timing within the period (start or end), the year-end action, a separate probation rate and a separate notice-period rate are all per type too.',
  },
  {
    q: 'What happens at year end?',
    a: 'One of three things, per type: carry forward up to a cap with the excess expiring, reset to zero, or encash. All three are written as ledger rows — carry-and-expire is two rows so “5 carried, 2 expired” is sayable, and the carry lands on both sides of the boundary so each year’s ledger adds up to its own balance. An overdrawn balance is left alone rather than quietly zeroed.',
  },
  {
    q: 'Is the accrual job safe to re-run?',
    a: 'Yes, by construction. Accrual rows are unique on employee, type and effective date, enforced by the database rather than by a check in application code. The job will be re-run — after a crash, or by a nervous administrator — and a double accrual is invisible until somebody takes leave they never earned.',
  },
  {
    q: 'Does probation or notice period change the rate?',
    a: 'Both can, and notice outranks probation where they overlap. A null rate in either case means the normal rate, never zero — a distinction worth stating because reading null as zero silently stops accrual for everybody on probation.',
  },
] as const;

export default function LeavePage() {
  return (
    <>
      <JsonLd schema={faqSchema(FAQS.map((f) => ({ q: f.q, a: f.a })))} />
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Product', href: '/product' },
          { label: 'Leave', href: '/product/leave' },
        ])}
      />

      <ProductHero
        eyebrow="Leave"
        title="A balance you can take apart into the rows that produced it."
        lede="Most systems store a leave balance as a number and adjust it. That works right up until somebody disputes it, at which point there is nothing to show them. Here a balance is the sum of a dated ledger — and every accrual, deduction, carry-forward and expiry is a row that stays where it was written."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
          <LeaveLedger />
          <LeaveTypes />
          <MobileApprovals className="mx-auto lg:mx-0" />
        </div>
      </ProductHero>

      {/* ── Accrual ─────────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Accrual</Eyebrow>
            <SectionTitle className="mt-3">Four rules, and the order matters.</SectionTitle>
            <Lead className="mt-4">
              Each one narrows what the next operates on, which is why applying them out of order
              produces a plausible number that is wrong.
            </Lead>
          </div>

          <div className="mt-12 grid gap-16">
            <FeatureBlock
              claim="LVA-03"
              eyebrow="The order"
              title="Which periods, then whether employed, then how much of a partial one, then at what rate."
              body="Skip to the last step and a November joiner receives a full year of entitlement — which is the bug this replaces. The rules run as a sequence: how many periods the leave year contains, whether the person was employed for a given period at all, what a partial first period is worth against the joining-cutoff day, and only then what the per-period rate is."
              points={[
                { text: 'Annual, half-yearly, quarterly or monthly accrual, per type', claim: 'LVA-01' },
                { text: 'Accrual timing within the period — at its start or at its end', claim: 'LVA-01' },
                { text: 'A separate probation rate, and a separate notice-period rate', claim: 'LVA-07' },
                { text: 'Notice outranks probation; a null rate means the normal rate, never zero', claim: 'LVA-07' },
              ]}
              screen={<LeaveTypes />}
            />

            <FeatureBlock
              claim="LVA-04"
              flip
              eyebrow="Idempotence"
              title="The job will be re-run. That must not double anybody's leave."
              body="Accrual rows are unique on employee, type and effective date — enforced by the database, not by a check somebody could forget. A re-run after a crash, or by an administrator who is not sure the first attempt worked, adds nothing it has already added. A double accrual is invisible until somebody takes leave they never earned, which is the worst possible moment to discover it."
              points={[
                { text: 'The same key guards the year-end close', claim: 'LVA-06' },
                { text: 'Nothing computes a balance — balance is SUM over the ledger', claim: 'LVA-02' },
                { text: 'A scheduled command drives it; there is no manual step to forget', claim: 'LVA-08' },
              ]}
              screen={
                <Panel label="Accrual run · idempotent">
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100" aria-hidden="true">
                        <svg viewBox="0 0 12 12" className="h-3 w-3 text-emerald-700" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2.5 6.2 4.8 8.5 9.5 3.8" />
                        </svg>
                      </span>
                      <p className="text-[12.5px] font-semibold text-n-900">Second run, same day</p>
                    </div>
                    <dl className="mt-3 grid gap-1.5 border-t border-n-100 pt-3 text-[12px]">
                      <div className="flex justify-between">
                        <dt className="text-n-600">Employees processed</dt>
                        <dd className="font-semibold text-n-800 tnum">42</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-n-600">Ledger rows written</dt>
                        <dd className="font-semibold text-n-900 tnum">0</dd>
                      </div>
                    </dl>
                    <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 font-mono text-[10.5px] leading-4 text-brand-800">
                      unique (user_id, leave_type_id, effective_on)
                    </p>
                  </div>
                </Panel>
              }
            />
          </div>
        </Container>
      </Section>

      {/* ── Year end ────────────────────────────────────────────────── */}
      <Section>
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Year end</Eyebrow>
            <SectionTitle className="mt-3">
              Three genuinely different obligations, not three presentation choices.
            </SectionTitle>
          </div>

          <div className="mt-12">
            <FeatureBlock
              claim="LVA-06"
              title="Every outcome is a row. Nothing is edited, nothing is deleted."
              body="Carry-forward moves up to the cap into the new year and expires the rest. Reset zeroes the balance. Encashment pays it out and creates a payroll liability the settlement run can find, rather than silently deleting it. All three are written as ledger entries, because the ledger is the explanation of a balance and an explanation you can rewrite is not one."
              points={[
                { text: 'Carry-and-expire is TWO rows, so “5 carried, 2 expired” is sayable', claim: 'LVA-06' },
                { text: 'The carry lands on both sides of the boundary, so each year’s ledger adds up to its own balance', claim: 'LVA-06' },
                { text: 'An overdrawn balance is left alone rather than quietly zeroed', claim: 'LVA-06' },
                { text: 'Encashment becomes a payroll liability, not a deletion', claim: 'LVA-05' },
              ]}
              screen={<LeaveLedger />}
              stat={{ value: '2 rows', label: 'what a carry-and-expire is written as, so both halves are explainable' }}
            />
          </div>
        </Container>
      </Section>

      {/* ── Requests ────────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Requests</Eyebrow>
            <SectionTitle className="mt-3">
              Including the case where the wrong person is the approver.
            </SectionTitle>
          </div>

          <div className="mt-12">
            <FeatureBlock
              claim="LVE-01"
              flip
              title="Approve, reject, revoke — or forward it to whoever should actually decide."
              body="A request routes to a default approver, who is frequently not the right one: the reporting manager is on leave themselves, or the decision belongs to a project lead. So a request can be transferred, with a lookup of valid forward targets, rather than sitting until somebody chases it. Approvals and revocations both work from the mobile app."
              points={[
                { text: 'Revoke an approval or a rejection after the fact, recorded as such', claim: 'LVE-01' },
                { text: 'Holiday calendars per organisation', claim: 'LVE-02' },
                { text: 'Encashment flows into payroll with its own approval', claim: 'LVE-03' },
                { text: 'Comp-off tracked as a balance with its own transactions', claim: 'TIM-07' },
              ]}
              screen={<MobileApprovals className="mx-auto" />}
            />
          </div>

          <div className="mt-16">
            <NotBuiltNote items={NOT_CLAIMED}>
              Leave is configured per organisation, which means the product does not assert what
              your entitlements ought to be.
            </NotBuiltNote>
          </div>
        </Container>
      </Section>

      <ProductCta
        title="Ask it why a balance is what it is."
        body="That is the question a leave module either answers with a list of dated rows or cannot answer at all."
      />
    </>
  );
}
