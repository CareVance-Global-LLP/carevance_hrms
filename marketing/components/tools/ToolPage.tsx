import Link from 'next/link';
import type { ReactNode } from 'react';
import { CTA } from '@/lib/site';
import { breadcrumbSchema, faqSchema, JsonLd } from '@/lib/schema';
import {
  Button,
  Card,
  Container,
  Eyebrow,
  Lead,
  Section,
  SectionTitle,
} from '@/components/ui/primitives';

/**
 * The shell every calculator sits in.
 *
 * Each tool page carries: the calculator itself, a plain-English explanation of
 * the rule it implements, the provenance of the arithmetic, an FAQ with
 * FAQPage schema, and ONE soft CTA at the end.
 *
 * The CTA is soft on purpose. Someone who arrived from a search for "gratuity
 * calculator" is not in a buying mood, and a modal over a free tool is how you
 * get the traffic without ever getting the trust. The tool is the marketing.
 */

export interface ToolFaq {
  q: string;
  a: string;
}

export function ToolPage({
  title,
  href,
  eyebrow,
  lede,
  calculator,
  explanation,
  provenance,
  faqs,
  related,
}: {
  title: string;
  href: string;
  eyebrow: string;
  lede: string;
  calculator: ReactNode;
  explanation: ReactNode;
  /** Which service and constants this tool mirrors. */
  provenance: string;
  faqs: readonly ToolFaq[];
  related?: ReadonlyArray<{ href: string; label: string }>;
}) {
  return (
    <>
      <JsonLd schema={faqSchema(faqs)} />
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Free tools', href: '/tools' },
          { label: title, href },
        ])}
      />

      <section className="pt-12 pb-8 sm:pt-16">
        <Container width="prose">
          <nav aria-label="Breadcrumb" className="mb-5">
            <ol className="flex items-center gap-1.5 text-[12.5px] text-n-600">
              <li>
                <Link href="/tools" className="underline-offset-4 hover:text-n-800 hover:underline">
                  Free tools
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li className="text-n-700">{title}</li>
            </ol>
          </nav>

          <Eyebrow>{eyebrow}</Eyebrow>
          <SectionTitle as="h1" className="mt-3">
            {title}
          </SectionTitle>
          <Lead className="mt-4">{lede}</Lead>
        </Container>
      </section>

      <Container width="prose">{calculator}</Container>

      <Section>
        <Container width="prose">
          <div className="grid gap-5 text-[15px] leading-7 text-n-700 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-n-900 [&_strong]:text-n-900">
            {explanation}
          </div>

          <div className="mt-8 rounded-xl border border-n-200 bg-sunken p-5">
            <p className="text-caption uppercase text-n-600">Where this arithmetic comes from</p>
            <p className="mt-2 text-[13.5px] leading-6 text-n-700">{provenance}</p>
            <p className="mt-2 text-[12.5px] leading-5 text-n-600">
              This calculator runs the same rules as the CareVance payroll engine, ported and
              spot-checked against it. FY 2025-26 figures. It is not tax advice, and an unusual
              situation deserves an accountant rather than a web form.
            </p>
          </div>
        </Container>
      </Section>

      <Section tone="sunken">
        <Container width="prose">
          <SectionTitle>Questions</SectionTitle>
          <div className="mt-6 divide-y divide-n-200 border-y border-n-200">
            {faqs.map((faq) => (
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

          {related && related.length > 0 && (
            <div className="mt-10">
              <p className="text-caption uppercase text-n-600">Related calculators</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {related.map((r) => (
                  <li key={r.href}>
                    <Link
                      href={r.href}
                      className="inline-flex rounded-lg border border-n-300 bg-card px-3 py-1.5 text-[13px] font-medium text-n-700 transition-colors hover:border-n-400 hover:text-n-900"
                    >
                      {r.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Card className="mt-10 p-6">
            <p className="font-display text-[17px] font-bold text-n-900">
              This is one rule. The engine behind it runs all of them.
            </p>
            <p className="mt-2 text-[14px] leading-6 text-n-600">
              CareVance computes PF, ESI, professional tax across 37 states, and cumulative TDS on
              either regime — then generates the returns and the bank file from the same run.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button href="/product/payroll">See the payroll engine</Button>
              <Button href={CTA.demoShort.href} tone="secondary">
                {CTA.demoShort.label}
              </Button>
            </div>
          </Card>
        </Container>
      </Section>
    </>
  );
}
