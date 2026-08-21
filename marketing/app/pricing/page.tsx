import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PricingCalculator } from '@/components/pricing/PricingCalculator';
import { FEATURE_MATRIX, PLAN_COLUMNS, NOT_BUILT, type PlanCode } from '@/lib/features';
import { GST_PERCENT, MIN_SEATS, TRIAL_DAYS, TRIAL_SEATS } from '@/lib/pricing';
import { faqSchema, productOfferSchema, breadcrumbSchema, JsonLd } from '@/lib/schema';
import {
  Button,
  Card,
  Container,
  Eyebrow,
  Lead,
  Section,
  SectionTitle,
} from '@/components/ui/primitives';
import { CTA } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'CareVance pricing, published in full. Per-user tracking plans from ₹399, workspace payroll plans from ₹3,999 including 50 seats. See your real per-employee cost at your headcount.',
  alternates: { canonical: '/pricing' },
};

const FAQS = [
  {
    q: 'How does the free trial work?',
    a: `${TRIAL_DAYS} days on Basic Tracking with ${TRIAL_SEATS} seats. No credit card required to start.`,
  },
  {
    q: 'What is the difference between the Tracking and Payroll plans?',
    a: 'Tracking plans are priced per user and cover evidence of work, attendance, leave and approvals. Payroll plans are priced per workspace, include 50 seats, and add the payroll engine, statutory computation, filings, bank files and core HR — plus everything in the tracking plans.',
  },
  {
    q: 'Why do the payroll plans include 50 seats when I have 20 people?',
    a: 'Because they are workspace-priced rather than per-user, which is the common convention in this market. It does mean that below 50 employees you are paying for seats you are not using — the calculator above shows your real per-employee cost at your headcount rather than hiding it behind the extra-seat rate.',
  },
  {
    q: 'Is payroll gated behind a higher tier?',
    a: 'It is in the payroll plans rather than the tracking plans, but it is in the entry payroll plan — full statutory compliance is not an upsell on top of it. Statutory compliance is usually why a buyer is here at all.',
  },
  {
    q: 'Can I add seats or change plans later?',
    a: 'Yes. Seats can be added from subscription settings, and you can move between plans at any time with prorated billing.',
  },
  {
    q: 'Is GST included?',
    a: `No. Every figure on this page excludes ${GST_PERCENT}% GST, which is charged on top.`,
  },
  {
    q: 'What happens to my data if I leave?',
    a: 'It is yours. Employee records, payroll runs, payslips and reports export to CSV, and payslips and statutory returns download as the files you would have filed anyway.',
  },
] as const;

export default function PricingPage() {
  return (
    <>
      <JsonLd schema={productOfferSchema()} />
      <JsonLd schema={faqSchema(FAQS.map((f) => ({ q: f.q, a: f.a })))} />
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Pricing', href: '/pricing' },
        ])}
      />

      <section className="pt-14 pb-10 sm:pt-20">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Pricing</Eyebrow>
            <SectionTitle as="h1" className="mt-3">
              Published in full, including the parts that are awkward.
            </SectionTitle>
            <Lead className="mt-4">
              Most vendors in this market do not show you a number until you have spoken to
              sales. Here is every price, a calculator that computes your real per-employee cost
              at your headcount, and a plain list of what we have not built.
            </Lead>
          </div>

          <div className="mt-10">
            <PricingCalculator />
          </div>
        </Container>
      </section>

      {/* ── Comparison ──────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Compare</Eyebrow>
            <SectionTitle className="mt-3">What is in each plan</SectionTitle>
            <Lead className="mt-4">
              Every row below is a capability that exists in the product today. Where a plain tick
              would overstate things, there is a footnote saying so.
            </Lead>
          </div>

          {/* Wide tables scroll inside their own container, never the page. */}
          <div className="mt-8 overflow-x-auto rounded-xl border border-n-200 bg-card">
            <table className="w-full min-w-[46rem] text-left text-[13.5px]">
              <caption className="sr-only">
                Feature comparison across the four CareVance plans
              </caption>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-n-200">
                  <th scope="col" className="px-5 py-3 font-semibold text-n-900">
                    Capability
                  </th>
                  {PLAN_COLUMNS.map((col) => (
                    <th key={col.code} scope="col" className="px-3 py-3 text-center">
                      <span className="block font-semibold text-n-900">{col.label}</span>
                      <span className="block text-[11px] font-medium text-n-600">{col.sub}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURE_MATRIX.map((cat) => (
                  <Fragment key={cat.category}>
                    <tr className="bg-sunken">
                      <th
                        scope="colgroup"
                        colSpan={5}
                        className="px-5 py-2 text-caption uppercase text-n-600"
                      >
                        {cat.category}
                      </th>
                    </tr>
                    {cat.features.map((row) => (
                      <tr
                        key={`${cat.category}-${row.name}`}
                        data-claim={row.claim}
                        className="border-b border-n-100 last:border-0"
                      >
                        <th scope="row" className="px-5 py-2.5 font-normal text-n-700">
                          {row.name}
                          {row.caveat && (
                            <span className="mt-0.5 block text-[11.5px] leading-4 text-n-600">
                              {row.caveat}
                            </span>
                          )}
                        </th>
                        {PLAN_COLUMNS.map((col) => (
                          <td key={col.code} className="px-3 py-2.5 text-center">
                            <Tick on={row[col.code as PlanCode]} label={`${row.name}, ${col.label} ${col.sub}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      {/* ── Not built ───────────────────────────────────────────────── */}
      <Section>
        <Container width="prose">
          <Eyebrow tone="accent">Not built</Eyebrow>
          <SectionTitle className="mt-3">What you will not get, stated up front.</SectionTitle>
          <Lead className="mt-4">
            If one of these is a requirement, we would rather you found out here than three weeks
            into an evaluation.
          </Lead>
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {NOT_BUILT.map((item) => (
              <li
                key={item}
                className="flex gap-2.5 rounded-lg border border-n-200 bg-card px-4 py-3 text-[13.5px] leading-5 text-n-700"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="mt-1 h-3 w-3 shrink-0 text-n-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container width="prose">
          <Eyebrow>Pricing questions</Eyebrow>
          <SectionTitle className="mt-3">The ones that decide it</SectionTitle>
          <div className="mt-8 divide-y divide-n-200 border-y border-n-200">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-display text-[16.5px] font-bold text-n-900">
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

          <Card className="mt-10 p-6 text-center">
            <p className="font-display text-lg font-bold text-n-900">
              Not sure which plan fits?
            </p>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-6 text-n-600">
              Twenty minutes with someone who can answer engine questions, not a script. Minimum{' '}
              {MIN_SEATS} seats on per-user plans.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button href={CTA.demo.href}>{CTA.demo.label}</Button>
              <Button href="/tools" tone="secondary">
                Try the free calculators first
              </Button>
            </div>
          </Card>

          <p className="mt-8 text-center text-[13px] text-n-600">
            Every number on this page comes from the product’s own pricing configuration.{' '}
            <Link href="/methodology" className="underline underline-offset-4 hover:text-n-800">
              How we count
            </Link>
          </p>
        </Container>
      </Section>
    </>
  );
}

function Tick({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <svg
      viewBox="0 0 16 16"
      className="mx-auto h-4 w-4 text-brand-600"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={`Included: ${label}`}
    >
      <path d="M3 8.5 6.2 11.6 13 4.6" />
    </svg>
  ) : (
    <span className="mx-auto block h-px w-3 bg-n-300" role="img" aria-label={`Not included: ${label}`} />
  );
}
