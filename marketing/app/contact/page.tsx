import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE, CTA } from '@/lib/site';
import { breadcrumbSchema, JsonLd } from '@/lib/schema';
import {
  Button,
  Card,
  Container,
  Eyebrow,
  Lead,
  Section,
  SectionTitle,
} from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Book a demo, ask an engine question, or send a security report. No forms that go nowhere — every address here reaches a person.',
  alternates: { canonical: '/contact' },
};

const ROUTES = [
  {
    title: 'Book a demo',
    body: 'Twenty minutes with someone who can answer questions about the payroll engine rather than read from a deck. Bring the edge case you already know the answer to — it is the fastest way to evaluate a statutory engine.',
    action: { href: `mailto:${SITE.salesEmail}?subject=Demo%20request`, label: SITE.salesEmail },
  },
  {
    title: 'Start a trial instead',
    body: `A 14-day trial on Basic Tracking with 5 seats, no credit card. If you would rather look before you talk, this is the door.`,
    action: { href: CTA.trial.href, label: 'Start free trial', primary: true },
  },
  {
    title: 'Support',
    body: 'For existing workspaces. Include your workspace name and, where relevant, the payroll run and month — it usually saves a round trip.',
    action: { href: `mailto:${SITE.supportEmail}`, label: SITE.supportEmail },
  },
  {
    title: 'Security reports',
    body: 'Acknowledged within two business days. We will not pursue anyone reporting in good faith. Details are on the security page.',
    action: { href: 'mailto:security@carevance.com', label: 'security@carevance.com' },
  },
  {
    title: 'Privacy and data requests',
    body: 'Access, correction, erasure and grievances under the DPDP Act. Also the address for a signed data processing addendum.',
    action: { href: `mailto:${SITE.privacyEmail}`, label: SITE.privacyEmail },
  },
  {
    title: 'Something on this site is wrong',
    body: 'Every figure here is counted from the codebase, and we would rather correct one than defend it. Tell us which number and where.',
    action: { href: 'mailto:hello@carevance.com', label: 'hello@carevance.com' },
  },
];

export default function ContactPage() {
  return (
    <>
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Contact', href: '/contact' },
        ])}
      />

      <section className="pt-14 pb-10 sm:pt-20">
        <Container width="prose">
          <Eyebrow>Contact</Eyebrow>
          <SectionTitle as="h1" className="mt-3">
            Six ways in, and all of them reach a person.
          </SectionTitle>
          <Lead className="mt-5">
            There is no contact form here that drops into a queue. These are real addresses, sorted
            by what you actually need, so you are not guessing which one gets read.
          </Lead>
        </Container>
      </section>

      <Section>
        <Container>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ROUTES.map((route) => (
              <Card key={route.title} className="flex flex-col p-6">
                <h2 className="font-display text-[17px] font-bold text-n-900">{route.title}</h2>
                <p className="mt-2 flex-1 text-[14px] leading-6 text-n-600">{route.body}</p>
                <div className="mt-4">
                  {route.action.primary ? (
                    <Button href={route.action.href}>{route.action.label}</Button>
                  ) : (
                    <a
                      href={route.action.href}
                      className="text-[13.5px] font-semibold text-brand-700 underline-offset-4 hover:underline"
                    >
                      {route.action.label}
                    </a>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      <Section tone="sunken">
        <Container width="prose">
          <SectionTitle>Before you write</SectionTitle>
          <p className="mt-4 leading-7 text-n-600">
            Three of the questions we get most often already have long answers on this site, and
            reading one may be faster than waiting for a reply:
          </p>
          <ul className="mt-5 grid gap-2.5">
            {[
              { href: '/pricing', label: 'What does it cost at my headcount?', note: 'the calculator on the pricing page' },
              { href: '/security', label: 'Are you SOC 2 certified?', note: 'no — and the security page says what is true instead' },
              { href: '/product/compliance', label: 'Which statutory returns can you file?', note: 'thirteen, named individually' },
            ].map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-n-200 bg-card px-4 py-3 transition-colors hover:border-n-300"
                >
                  <span className="text-[14px] font-semibold text-n-900">{item.label}</span>
                  <span className="text-[13px] text-n-600">— {item.note}</span>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-[13px] leading-6 text-n-600">
            {/*
              Registered entity details are a legal requirement on an Indian
              commercial site and are pending from the founder. Marked rather
              than invented — see PRODUCT_TRUTH.md §6.
            */}
            Registered company details and address are being added to this page. Until then, all
            correspondence reaches us at the addresses above.
          </p>
        </Container>
      </Section>
    </>
  );
}
