import type { Metadata } from 'next';
import Link from 'next/link';
import { ALL_FACTS } from '@/lib/facts';
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
  title: 'How we count',
  description:
    'Every number published on this site, what it counts, and where it was counted from. Plus the things we deliberately do not claim: customer counts, review scores, certification badges and uptime figures.',
  alternates: { canonical: '/methodology' },
};

const NOT_PUBLISHED = [
  {
    thing: 'Customer counts, logo walls and testimonials',
    why: 'We are early, and we are not going to manufacture social proof on a site selling payroll software. When we have customers who are willing to be named, they will appear here with a date.',
  },
  {
    thing: 'Review scores and award badges',
    why: 'We have no G2 score and no awards. A badge is also only as good as its date — a vendor displaying a three-year-old award badge is signalling decline, not credibility.',
  },
  {
    thing: 'SOC 2 or ISO 27001 marks',
    why: 'Neither certification has been obtained. The security page states this plainly rather than leaving an absence for you to notice.',
  },
  {
    thing: 'Uptime percentages and SLAs',
    why: 'We do not have the operating history to stand behind a published availability figure, and a number we cannot defend is worse than no number.',
  },
  {
    thing: 'Productivity or ROI improvement claims',
    why: 'Any “32% productivity lift” figure without a named study, a sample size and a date is decoration. We have no such study, so we make no such claim.',
  },
];

export default function MethodologyPage() {
  return (
    <>
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'How we count', href: '/methodology' },
        ])}
      />

      <section className="pt-14 pb-10 sm:pt-20">
        <Container width="prose">
          <Eyebrow>Methodology</Eyebrow>
          <SectionTitle as="h1" className="mt-3">
            Every number on this site, and where it came from.
          </SectionTitle>
          <Lead className="mt-5">
            Marketing numbers are usually unfalsifiable. These are not: each one was counted from
            the CareVance codebase on a stated date, by a stated method, and you can hold us to the
            method. Publishing it costs nothing and defuses the obvious scepticism.
          </Lead>
          <p className="mt-5 text-[13px] text-n-600">
            Counted 20 August 2026. The repository moves; figures are re-verified before each
            substantive update to this site.
          </p>
        </Container>
      </section>

      <Section tone="sunken">
        <Container>
          <SectionTitle>The figures</SectionTitle>
          <p className="mt-3 max-w-2xl text-[15px] leading-7 text-n-600">
            Each row carries the identifier it was audited under. The same identifier appears in
            the page markup as a <code className="rounded bg-n-100 px-1 py-0.5 text-[13px]">data-claim</code>{' '}
            attribute wherever the figure is used, so a claim on this site can be traced to its
            source mechanically rather than by trust.
          </p>

          <div className="mt-8 overflow-x-auto rounded-xl border border-n-200 bg-card">
            <table className="w-full min-w-[42rem] text-left text-[13.5px]">
              <caption className="sr-only">Published figures and their sources</caption>
              <thead>
                <tr className="border-b border-n-200">
                  <th scope="col" className="px-5 py-3 font-semibold text-n-900">
                    Figure
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold text-n-900">
                    What it counts
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold text-n-900">
                    Source &amp; method
                  </th>
                </tr>
              </thead>
              <tbody>
                {ALL_FACTS.map((f) => (
                  <tr key={f.id} className="border-b border-n-100 align-top last:border-0">
                    <th scope="row" className="px-5 py-3 whitespace-nowrap">
                      <span className="font-display text-lg font-bold text-n-900 tnum">
                        {f.value}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10.5px] font-normal text-n-500">
                        {f.id}
                      </span>
                    </th>
                    <td className="px-3 py-3 text-n-700">{f.label}</td>
                    <td className="px-5 py-3 text-[13px] leading-6 text-n-600">{f.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      <Section>
        <Container width="prose">
          <Eyebrow tone="accent">Deliberately absent</Eyebrow>
          <SectionTitle className="mt-3">What we do not publish, and why</SectionTitle>
          <Lead className="mt-4">
            The absence of these is a decision, not an oversight. On a site asking you to trust us
            with salary data, a fabricated trust signal would be a lie about the exact thing being
            bought.
          </Lead>

          <div className="mt-8 grid gap-4">
            {NOT_PUBLISHED.map((item) => (
              <Card key={item.thing} className="border-n-300 p-5">
                <p className="font-semibold text-n-900">{item.thing}</p>
                <p className="mt-1.5 text-[14px] leading-6 text-n-600">{item.why}</p>
              </Card>
            ))}
          </div>

          <div className="mt-10 rounded-xl border border-n-200 bg-sunken p-6">
            <p className="text-caption uppercase text-n-600">How the calculators are checked</p>
            <p className="mt-2.5 text-[14.5px] leading-7 text-n-700">
              The free calculators are a port of the payroll engine’s own arithmetic, not a second
              implementation. A test suite runs on every change and asserts the ported figures
              against values derived from the engine — the CTC balance, the PF ceiling, the ESI
              threshold at both sides of the boundary, the five-year gratuity floor and the
              statutory ceiling, the HRA limbs, and the Section 87A marginal-relief band above ₹12
              lakh.
            </p>
            <p className="mt-3 text-[14.5px] leading-7 text-n-700">
              The professional tax table is not transcribed at all. It is extracted from the
              engine’s state configuration by a script, so there is exactly one copy of those slabs
              and this site reads it rather than duplicating it.
            </p>
          </div>

          <p className="mt-8 text-[13.5px] leading-6 text-n-600">
            Found a number here that looks wrong? Tell us at{' '}
            <a
              href="mailto:hello@carevance.com"
              className="font-medium text-n-700 underline underline-offset-4"
            >
              hello@carevance.com
            </a>{' '}
            and we will correct it or remove it. See also the{' '}
            <Link href="/security" className="underline underline-offset-4 hover:text-n-800">
              security page
            </Link>
            , which applies the same standard to what is and is not implemented.
          </p>
        </Container>
      </Section>
    </>
  );
}
