import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { SECURITY } from '@/lib/facts';
import { breadcrumbSchema, faqSchema, JsonLd } from '@/lib/schema';
import {
  Card,
  Container,
  Eyebrow,
  Lead,
  Section,
  SectionTitle,
} from '@/components/ui/primitives';
import { ProductCta } from '@/components/product/PageParts';
import { ConsentNotice } from '@/components/product/screens';
import { Reveal } from '@/components/motion/Reveal';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'What is actually true about CareVance security today, and what is not: tenant isolation enforced at the ORM layer and covered by a test, TOTP two-factor, append-only audit trails, DPDP consent machinery — and no certification badges we have not earned.',
  alternates: { canonical: '/security' },
};

const LAST_REVIEWED = '20 August 2026';

const IMPLEMENTED = [
  {
    claim: 'SEC-01',
    title: 'Tenant isolation is structural, not conventional',
    body: `${SECURITY.scopedModels.value} models carry a trait that applies an organisation scope to every query and stamps the tenant on create. Reading across tenants is not merely discouraged — it requires writing an explicit call, which means a reviewer can find every instance with a single grep rather than trusting that nobody forgot.`,
  },
  {
    claim: 'SEC-02',
    title: 'And a test fails the build if it lapses',
    body: 'A model that owns tenant-scoped data but omits the trait breaks continuous integration. Isolation is therefore enforced by the test suite rather than by a reviewer remembering — which is the difference between a policy and a guarantee.',
  },
  {
    claim: 'SEC-03',
    title: 'Two-factor authentication, enforceable per organisation',
    body: 'TOTP with recovery codes. Each organisation sets its own policy — off, grace, or enforced — with an explicit grace deadline, and privileged roles can be required to enrol before they can use the API at all.',
  },
  {
    claim: 'SEC-04',
    title: 'Role-based access, with payroll routes tested',
    body: 'Organisation roles, group access rules and route-level gating. Which roles may reach which payroll endpoints is asserted by a test, including the allow-list that keeps employees to their own figures rather than the whole company’s.',
  },
  {
    claim: 'SEC-05',
    title: 'Break-glass access is a recorded session',
    body: 'Elevated access is not a flag someone sets and forgets. It opens a session with a beginning, an end and a record, so the question “who could see this, and when” has an answer.',
  },
  {
    claim: 'CTL-05',
    title: 'Append-only audit trails',
    body: 'Payroll changes, override decisions and platform actions are written to audit logs that are added to rather than edited. An override carries its own trail: what was proposed, by whom, what the engine would have produced, and who approved it.',
  },
  {
    claim: 'SEC-08',
    title: 'Rate limiting on authentication',
    body: 'Login and two-factor verification are throttled, so a stolen password cannot be paired with an unlimited run at the second factor.',
  },
  {
    claim: 'SEC-07',
    title: 'Input sanitisation on user-supplied content',
    body: 'Rich content submitted by users is sanitised before storage rather than escaped inconsistently at each render site.',
  },
];

const NOT_TRUE = [
  {
    title: 'No SOC 2 report',
    body: 'We have not completed a SOC 2 Type I or Type II audit. If your procurement process requires one, we cannot satisfy it today, and we would rather you learned that here than in week three of an evaluation.',
  },
  {
    title: 'No ISO 27001 certificate',
    body: 'Not certified, and not currently in an audit process. There is no badge on this page because there is nothing to put on it.',
  },
  {
    title: 'No SSO or SAML',
    body: 'Google OAuth is the only federated sign-in. SAML, SCIM provisioning and directory sync are not built. For many enterprise buyers this is the deciding gap, and it is a fair one.',
  },
  {
    title: 'No published uptime or SLA',
    body: 'We do not publish an availability figure or offer a contractual SLA, because we do not yet have the operating history to stand behind either. Enterprise terms are agreed in writing rather than implied by a page like this one.',
  },
];

const FAQS = [
  {
    q: 'Is my organisation’s data separated from other customers’?',
    a: 'Yes, and structurally. Ninety-seven models apply an organisation scope at the ORM layer and stamp the tenant on create, so a query that would cross tenants has to be written deliberately and is greppable in review. A test in continuous integration fails the build if a tenant-owned model is added without that scope.',
  },
  {
    q: 'Are you SOC 2 or ISO 27001 certified?',
    a: 'No. Neither. We are not going to display a badge we have not earned on a page where you are deciding whether to hand us salary data. What we can offer instead is specific, checkable statements about how the system is built, and a conversation with the people who built it.',
  },
  {
    q: 'Can you enforce two-factor authentication across my company?',
    a: 'Yes. Each organisation sets its own policy — off, grace with a deadline, or enforced — and privileged roles can be required to enrol before they can use the API. TOTP with recovery codes; SMS is deliberately not offered.',
  },
  {
    q: 'How is employee monitoring data handled?',
    a: 'Through a single consent gate that every capture path passes: screenshots, activity, geofenced punches and attendance selfies. Notices are versioned and never edited in place, consent is recorded per capture type with request context, it can be withdrawn, and capture is refused once the collection window closes without it. Screenshots have a scheduled retention purge.',
  },
  {
    q: 'Who at CareVance can see my payroll data?',
    a: 'Ordinary access follows the same organisation scope every other query does. Elevated support access opens a break-glass session that is recorded with a beginning and an end. There is no ambient administrative view of customer payroll.',
  },
  {
    q: 'What happens to our data if we leave?',
    a: 'It is yours. Employee records, payroll runs, payslips and reports export to CSV; payslips and statutory returns download as the files you would have filed anyway. Retention and deletion after termination are covered in the data processing addendum.',
  },
] as const;

export default function SecurityPage() {
  return (
    <>
      <JsonLd schema={faqSchema(FAQS.map((f) => ({ q: f.q, a: f.a })))} />
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Security', href: '/security' },
        ])}
      />

      <section className="pt-14 pb-10 sm:pt-20 lg:pt-24">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Security</Eyebrow>
            <SectionTitle as="h1" className="mt-3">
              You are deciding whether to hand a stranger your salary data.
            </SectionTitle>
            <Lead className="mt-5">
              So this page is written the way we would want one written for us: what is actually
              implemented, stated specifically enough to check — and, in equal detail, what is not.
              There are no badges here, because we have not earned any.
            </Lead>
            <p className="mt-6 text-[13px] text-n-600">
              Last reviewed <time dateTime="2026-08-20">{LAST_REVIEWED}</time>. Security pages that
              carry no date are asking you to trust an unknown vintage.
            </p>
          </div>
        </Container>
      </section>

      {/* ── What is true ────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Implemented today</Eyebrow>
            <SectionTitle className="mt-3">Specific enough to be checked.</SectionTitle>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {IMPLEMENTED.map((item) => (
              <Card key={item.claim} data-claim={item.claim} className="p-6">
                <h3 className="font-display text-[17px] leading-snug font-bold text-balance text-n-900">
                  {item.title}
                </h3>
                <p className="mt-2.5 text-[14px] leading-6 text-pretty text-n-600">{item.body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── What is not ─────────────────────────────────────────────── */}
      <Section>
        <Container>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-14">
            <div>
              <Eyebrow tone="accent">Not true today</Eyebrow>
              <SectionTitle className="mt-3">The part most vendors omit.</SectionTitle>
              <Lead className="mt-4">
                A security page that lists only strengths is a marketing page. These are the gaps
                that would actually stop a deal, said plainly.
              </Lead>

              <div className="mt-8 grid gap-4">
                {NOT_TRUE.map((item) => (
                  <div key={item.title} className="border-l-2 border-n-300 pl-4">
                    <h3 className="font-semibold text-n-900">{item.title}</h3>
                    <p className="mt-1 text-[14px] leading-6 text-n-600">{item.body}</p>
                  </div>
                ))}
              </div>

              <Card className="mt-8 border-accent-200 bg-accent-50 p-5">
                <p className="text-[14px] leading-6 text-n-700">
                  <strong className="text-n-900">On roadmaps.</strong> We are not going to publish
                  dates for certifications we have not started. When an audit begins, this page
                  will say so, with the date it began — and until then the absence of a claim is
                  the claim.
                </p>
              </Card>
            </div>

            <Reveal>
              <div className="grid gap-4">
                <ConsentNotice />
                <Card data-claim="CON-06" className="p-5">
                  <p className="text-caption uppercase text-n-600">Why consent ships with it</p>
                  <p className="mt-2 text-[13.5px] leading-6 text-n-600">
                    Under the DPDP Act, the penalty for collecting employee data without notice
                    falls on the employer running the software, not on the vendor that wrote it. A
                    tracker shipped without consent machinery hands you that liability and calls it
                    a feature.
                  </p>
                </Card>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* ── Reporting ───────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container width="prose">
          <Eyebrow>Reporting a vulnerability</Eyebrow>
          <SectionTitle className="mt-3">Tell us, and we will answer.</SectionTitle>
          <p className="mt-4 leading-7 text-n-600">
            Email{' '}
            <a
              href={`mailto:security@carevance.com`}
              className="font-semibold text-brand-700 underline underline-offset-4"
            >
              security@carevance.com
            </a>{' '}
            with enough detail to reproduce the issue. We will acknowledge within two business days
            and keep you updated until it is resolved. We will not pursue legal action against
            anyone who reports in good faith, avoids privacy violations and data destruction, and
            gives us reasonable time before disclosing publicly.
          </p>
          <p className="mt-4 leading-7 text-n-600">
            We do not currently run a paid bug bounty. We would rather say that than imply one.
          </p>

          <div className="mt-10 divide-y divide-n-200 border-y border-n-200">
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

          <p className="mt-8 text-[13px] leading-6 text-n-600">
            Data processing terms are in the{' '}
            <Link href="/legal/dpa" className="underline underline-offset-4 hover:text-n-800">
              data processing addendum
            </Link>
            . Questions about how we handle personal data go to{' '}
            <a
              href={`mailto:${SITE.privacyEmail}`}
              className="underline underline-offset-4 hover:text-n-800"
            >
              {SITE.privacyEmail}
            </a>
            .
          </p>
        </Container>
      </Section>

      <ProductCta
        title="Bring your security questionnaire."
        body="We will fill it in honestly, including the rows where the answer is no. That is faster for both of us than discovering them in week three."
      />
    </>
  );
}
