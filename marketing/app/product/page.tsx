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
              <strong>Candidates cannot apply to you.</strong> Hiring is here — openings, a
              configurable pipeline, panel feedback, offers with an approval chain, a signed offer
              letter — but there is no public careers page. Somebody records a candidate; the
              candidate does not record themselves.
            </p>
            <p>
              <strong>Background verification has no vendor behind it.</strong> The consent
              machinery, the scope enforcement and the findings model are all real. What is missing
              is a connection to AuthBridge or IDfy, so a human enters what the check found.
            </p>
            <p>
              <strong>SCIM syncs people, not groups.</strong> SAML single sign-on works and
              deprovisioning genuinely revokes access. But <code>/Groups</code> is unimplemented,
              so somebody arrives from your directory without the role they should have.
            </p>
            <p>
              <strong>The roster has no drag-and-drop.</strong> Rotations, generation, publishing,
              coverage and three-party swaps all exist. Moving one person to nights on the 14th is
              a form, not a drag.
            </p>
            <p>
              <strong>Accounting export produces a file.</strong> The journal is real double-entry
              and it balances or nothing is produced — but it lands as Tally XML or a Zoho Books
              CSV that somebody imports, not as an API call into either.
            </p>
            <p>
              <strong>And it is English only.</strong> There is no i18n layer of any kind, which
              caps self-service adoption on a shop floor more than any missing feature does.
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
