import type { Metadata } from 'next';
import Link from 'next/link';
import { TOOLS } from '@/lib/site';
import { PT_STATES, PT_NIL_COUNT } from '@/lib/pt-states';
import { breadcrumbSchema, JsonLd } from '@/lib/schema';
import {
  Card,
  Container,
  Eyebrow,
  Lead,
  Section,
  SectionTitle,
} from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Free payroll calculators',
  description:
    'Free Indian payroll calculators — salary breakup, take-home, gratuity, HRA exemption and professional tax by state. Each one runs the same arithmetic as the CareVance payroll engine.',
  alternates: { canonical: '/tools' },
};

/** Planned, and labelled as planned. A greyed card that never ships is a lie. */
const PLANNED = [
  'PF / EPF contribution',
  'ESI eligibility',
  'TDS: old vs new regime',
  'Bonus under the Payment of Bonus Act',
];

export default function ToolsIndex() {
  return (
    <>
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Free tools', href: '/tools' },
        ])}
      />

      <section className="pt-14 pb-8 sm:pt-20">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Free tools</Eyebrow>
            <SectionTitle as="h1" className="mt-3">
              Calculators that agree with the payroll engine behind them.
            </SectionTitle>
            <Lead className="mt-4">
              No sign-up, no email gate, no modal. Each of these runs the same arithmetic as the
              CareVance engine — the constants, the caps, the marginal relief and the refusals — so
              you can check our numbers against your own payslip before you trust us with anything.
            </Lead>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {TOOLS.map((tool, i) => (
              <Card key={tool.href} interactive className={i === 4 ? 'sm:col-span-2' : undefined}>
                <Link href={tool.href} className="block p-6">
                  <h2 className="font-display text-[17px] font-bold text-n-900">{tool.label}</h2>
                  <p className="mt-2 text-[14px] leading-6 text-n-600">{tool.blurb}</p>
                  {i === 4 && (
                    <p className="mt-3 inline-flex rounded-md bg-accent-100 px-2 py-1 text-[11.5px] font-semibold text-accent-700">
                      All {PT_STATES.length} states and UTs — including the {PT_NIL_COUNT} that
                      levy nothing
                    </p>
                  )}
                  <p className="mt-3 text-[13px] font-semibold text-brand-700">Open calculator →</p>
                </Link>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <Section tone="sunken">
        <Container>
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <SectionTitle>Why these are right</SectionTitle>
              <div className="mt-4 grid gap-4 text-[15px] leading-7 text-n-700">
                <p>
                  Most payroll calculators on the Indian web are wrong in at least one of four
                  ways: they compare the Section 87A rebate against gross rather than taxable
                  income, they omit marginal relief above ₹12 lakh, they ignore the five-year
                  gratuity floor, or they list eight states for professional tax and leave everyone
                  else guessing.
                </p>
                <p>
                  These do not, because they are not independent implementations. The arithmetic is
                  ported from the payroll engine and spot-checked against it by a test that runs on
                  every change; the professional tax table is extracted from the engine by a script
                  rather than transcribed.
                </p>
                <p>
                  That is also the point. A calculator you can check against your own payslip is an
                  unsupervised trial of the engine — which is a more honest sales argument than any
                  claim we could make about it.
                </p>
              </div>
            </div>

            <div>
              <Eyebrow tone="muted">Planned</Eyebrow>
              <p className="mt-3 text-[14px] leading-6 text-n-600">
                These are not built yet. They are listed because they are coming, not to pad the
                page — there is no greyed-out card here pretending to be a link.
              </p>
              <ul className="mt-4 grid gap-2">
                {PLANNED.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-2.5 rounded-lg border border-dashed border-n-300 px-4 py-2.5 text-[13.5px] text-n-600"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-n-300" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[12.5px] leading-5 text-n-600">
                The take-home calculator already computes old versus new regime side by side, so
                that one is partly covered today.
              </p>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
