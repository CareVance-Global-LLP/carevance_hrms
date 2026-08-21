import type { Metadata } from 'next';
import Link from 'next/link';
import { PRODUCT_FEATURED, PRODUCT_MORE } from '@/lib/site';
import { SCALE, STATUTORY } from '@/lib/facts';
import { breadcrumbSchema, JsonLd } from '@/lib/schema';
import {
  Card,
  Container,
  Eyebrow,
  Lead,
  Section,
  SectionTitle,
} from '@/components/ui/primitives';
import { ProductHero, ProductCta } from '@/components/product/PageParts';
import { UnbrokenChain } from '@/components/home/UnbrokenChain';
import { CountUp } from '@/components/motion/CountUp';
import { MobileApprovals, TrackerCapture } from '@/components/product/screens';

export const metadata: Metadata = {
  title: 'Platform overview',
  description:
    'One system from a tracked minute to a filed return: the desktop tracker, attendance, the payroll engine, statutory computation, bank files and payslips — across web, mobile, desktop and a browser extension.',
  alternates: { canonical: '/product' },
};

const APPS = [
  {
    name: 'Web application',
    detail: `${SCALE.screens.value} screens covering payroll, people, time, projects and reports. This is where admins and finance live.`,
    claim: 'NUM-04',
  },
  {
    name: 'Mobile app',
    detail: `${SCALE.mobileScreens.value} screens on iOS and Android: payslips, leave, attendance, comp-off, regularisation — and a manager approval inbox.`,
    claim: 'NUM-06',
  },
  {
    name: 'Desktop tracker',
    detail: 'An Electron app that captures screenshots, reads OS-level idle, and queues to disk when the network drops.',
    claim: 'TIM-01',
  },
  {
    name: 'Browser extension',
    detail: 'Supplies URL context to activity classification, so “a browser was open” becomes “this was the work”.',
    claim: 'TIM-02',
  },
];

export default function ProductOverview() {
  return (
    <>
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Product', href: '/product' },
        ])}
      />

      <ProductHero
        eyebrow="Platform"
        title="One system, from a tracked minute to a filed return."
        lede="CareVance is not a suite of products that integrate. It is one database, one permission model and one audit trail, with the tracker and the payroll engine reading the same records. That is an architectural claim rather than a marketing one, and the rest of this page is the evidence for it."
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[SCALE.routes, SCALE.models, SCALE.services, STATUTORY.ptStates].map((f) => (
            <div key={f.id} data-claim={f.id} className="rounded-xl border border-n-200 bg-card p-5">
              <dd>
                <CountUp
                  value={f.value}
                  n={f.n}
                  title={f.source}
                  className="font-display text-2xl font-bold text-n-900"
                />
              </dd>
              <dt className="mt-1 text-[12.5px] leading-5 text-n-600">{f.label}</dt>
            </div>
          ))}
        </dl>
      </ProductHero>

      {/* The chain, reused from the homepage — it is the same argument. */}
      <UnbrokenChain />

      {/* ── Modules ─────────────────────────────────────────────────── */}
      <Section tone="sunken" id="tour">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Modules</Eyebrow>
            <SectionTitle className="mt-3">What is in the box</SectionTitle>
            <Lead className="mt-4">
              Four of these have their own page written. The rest are built and shipping, but their
              pages are still being written — and are marked as such rather than filled with copy
              nobody has checked.
            </Lead>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...PRODUCT_FEATURED.slice(1), ...PRODUCT_MORE].map((item) => (
              <Card key={item.href} interactive>
                <Link href={item.href} className="block p-6">
                  <h3 className="flex items-center gap-2 font-display text-[17px] font-bold text-n-900">
                    {item.label}
                    {item.placeholder && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400"
                        title="Page in progress"
                        aria-label="(page in progress)"
                      />
                    )}
                  </h3>
                  {item.blurb && (
                    <p className="mt-2 text-[14px] leading-6 text-n-600">{item.blurb}</p>
                  )}
                  <p className="mt-3 text-[13px] font-semibold text-brand-700">Read more →</p>
                </Link>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Apps ────────────────────────────────────────────────────── */}
      <Section>
        <Container>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-14">
            <div>
              <Eyebrow>Four apps</Eyebrow>
              <SectionTitle className="mt-3">
                Because the work does not all happen in a browser tab.
              </SectionTitle>
              <Lead className="mt-4">
                An engineer at a desk, a site supervisor with a phone, and a finance lead in a
                spreadsheet need different surfaces. They should not need different vendors.
              </Lead>

              <ul className="mt-8 grid gap-5">
                {APPS.map((app) => (
                  <li key={app.name} data-claim={app.claim} className="border-l-2 border-brand-300 pl-4">
                    <p className="font-semibold text-n-900">{app.name}</p>
                    <p className="mt-1 text-[14px] leading-6 text-n-600">{app.detail}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
              <TrackerCapture />
              <MobileApprovals className="mx-auto sm:mx-0" />
            </div>
          </div>
        </Container>
      </Section>

      {/* ── The honest boundary ─────────────────────────────────────── */}
      <Section tone="sunken">
        <Container width="prose">
          <Eyebrow tone="accent">The boundary</Eyebrow>
          <SectionTitle className="mt-3">What CareVance is not</SectionTitle>
          <div className="mt-5 grid gap-4 text-[15px] leading-7 text-n-700">
            <p>
              It is not a recruitment system. There is no applicant tracking, no job posting, no
              candidate pipeline, no offer letter and no e-signature. If your evaluation is
              hire-to-retire, the hire half is missing and no amount of framing changes that.
            </p>
            <p>
              It is not an enterprise identity platform. Google OAuth is the only federated
              sign-in; SAML, SCIM and directory sync do not exist. Two-factor authentication does,
              and can be enforced.
            </p>
            <p>
              It does not model multiple legal entities. One organisation is one PAN, one TAN and
              one PF code — a group with three registered companies needs three workspaces today.
            </p>
            <p>
              And leave is a flat annual quota. No accrual schedule, no pro-rating for a mid-year
              joiner, no per-type carry-forward caps. It works, and it is simpler than what a
              1,000-person company will want.
            </p>
          </div>
          <p className="mt-6 text-[13px] leading-6 text-n-600">
            Every claim on this site — including these — traces to a line in an audit of the
            codebase.{' '}
            <Link href="/methodology" className="underline underline-offset-4 hover:text-n-800">
              How we count
            </Link>
          </p>
        </Container>
      </Section>

      <ProductCta />
    </>
  );
}
