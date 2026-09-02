import type { Metadata } from 'next';
import Link from 'next/link';
import { breadcrumbSchema, JsonLd } from '@/lib/schema';
import {
  Card,
  Container,
  Eyebrow,
  Lead,
  Section,
  SectionTitle,
} from '@/components/ui/primitives';
import { ProductCta } from '@/components/product/PageParts';
import { OverrideRefusal, OverrideRegister } from '@/components/product/screens';
import { Reveal } from '@/components/motion/Reveal';

export const metadata: Metadata = {
  title: 'Why CareVance',
  description:
    'The long-form argument: why owning the whole chain from tracked work to filed return produces a different product than integrating three vendors, and where that argument stops.',
  alternates: { canonical: '/why-carevance' },
};

export default function WhyPage() {
  return (
    <>
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Why CareVance', href: '/why-carevance' },
        ])}
      />

      <section className="pt-14 pb-10 sm:pt-20 lg:pt-24">
        <Container width="prose">
          <Eyebrow>The argument</Eyebrow>
          <SectionTitle as="h1" className="mt-3">
            One system, and what that actually buys you.
          </SectionTitle>
          <Lead className="mt-5">
            “Integrated platform” is the emptiest phrase in enterprise software. Everyone claims it,
            almost nobody means it, and the buyer has no way to tell from a website. So here is the
            specific version of the claim, the mechanism behind it, and the place where it runs out.
          </Lead>
        </Container>
      </section>

      <Section>
        <Container width="prose">
          <article className="grid gap-6 text-[16px] leading-8 text-n-700 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-n-900 [&_h3]:mt-4 [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-n-900 [&_strong]:text-n-900">
            <h2>The gap where the month goes wrong</h2>
            <p>
              A company of eighty people typically runs a time tracker from one vendor, an HRMS from
              another, and payroll from a third. Each is fine. The problem is not any of them — it
              is the seam.
            </p>
            <p>
              On the 25th, someone exports attendance to a CSV and imports it into payroll. The
              column names have drifted, or a joiner is missing, or a regularisation approved on the
              24th did not make the export. The numbers disagree, and because the evidence lives in
              a system the payroll admin cannot see, the disagreement is settled by whoever is more
              confident rather than by looking.
            </p>
            <p>
              That seam is where payroll disputes are born, and it is also why “we integrate with
              your tracker” is a weaker promise than it sounds. An integration is a copy. Copies
              drift.
            </p>

            <h2>What owning the chain actually means</h2>
            <p>
              In CareVance the tracker’s output is not exported into attendance — it{' '}
              <strong>is</strong> attendance. The attendance record is not exported into payroll —
              a single endpoint makes it the basis of the run, with a status you can read before you
              trust it. The payslip is not a rendering of a separate calculation; it is a view of
              the same versioned payroll item the statutory computation produced.
            </p>
            <p>
              So the question “why is Priya’s August gross ₹1,15,891?” has an answer that does not
              require opening a second product: because 22 days were synced from attendance, which
              came from these tracked sessions, which produced this structure, less these deductions,
              adjusted by this override, approved by this person.
            </p>
            <p>
              That is the whole claim. It is architectural, it is checkable, and it is the reason
              the rest of this site can be as specific as it is.
            </p>

            <h2>The second thing, which matters more than we expected</h2>
            <p>
              Owning the chain makes a second property possible: <strong>every figure can explain
              itself</strong>. Because the override register keeps the value the engine would have
              produced alongside the value that was applied, a difference is never just a
              difference — it carries its cause.
            </p>
            <p>
              This turned out to have a sharp practical edge. When an admin raises Basic by ₹12,000,
              Special Allowance does not fall by ₹12,000. It falls by about ₹20,000, because HRA is
              derived from Basic and employer PF and the gratuity provision sit inside the same CTC
              envelope. Four quantities move together, at roughly 1.668× the face value of the
              change.
            </p>
            <p>
              Most systems apply that silently and let the admin discover it on the payslip. Ours
              shows it in a preview before the change is committed — and when the change genuinely
              cannot balance, it refuses at entry and names the maximum that would work.
            </p>
          </article>

          <Reveal className="my-10 grid gap-4 sm:grid-cols-2">
            <OverrideRegister />
            <OverrideRefusal />
          </Reveal>

          <article className="grid gap-6 text-[16px] leading-8 text-n-700 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-n-900 [&_strong]:text-n-900">
            <h2>Refusing is a feature, not a limitation</h2>
            <p>
              A negative residual is not a warning; it is an impossible structure. The alternatives
              in this market are to drop components silently, or to accept the value and reject it
              weeks later at finalisation — as a batch-wide event, at the worst point in the payroll
              calendar, when the person who made the change has forgotten they made it.
            </p>
            <p>
              Refusing at entry costs the admin thirty seconds while they are looking at the screen.
              Every other option costs someone a day in the last week of the month.
            </p>

            <h2>Where this argument stops</h2>
            <p>
              It does not make us a better HRMS in every dimension, and it would be dishonest to
              pretend the architecture compensates for the gaps.
            </p>
            <p>
              <strong>Nobody can apply to you.</strong> There is a full hiring pipeline behind the
              login — openings, stages, panel feedback, an offer approval chain, a signed letter —
              and no public careers page in front of it. If your bottleneck is inbound applicant
              volume, that is the wrong shape of product.
            </p>
            <p>
              <strong>SCIM syncs people but not groups.</strong> Single sign-on works, and
              deprovisioning genuinely revokes tokens rather than setting a flag. But somebody
              arrives from your directory without the role they should have, and for an
              identity-led procurement that is the gap that matters.
            </p>
            <p>
              <strong>Background verification has no vendor.</strong> <strong>Accounting export
              produces a file, not an API call.</strong> <strong>The roster has no drag-and-drop.</strong>{' '}
              <strong>Biometric ingestion is push only</strong>, so a terminal on a LAN with no
              outbound route cannot reach us. And four of the twenty-three statutory documents are
              preparation sheets rather than returns.
            </p>
            <p>
              <strong>It is English only.</strong> No i18n layer of any kind. On a shop floor that
              caps self-service adoption more than any missing module does, and it is the gap we
              are least comfortable with.
            </p>
            <p>
              If any of those is your deciding requirement, the right answer is a different product,
              and finding that out from this page costs you five minutes instead of five weeks.
            </p>

            <h2>Who this is actually for</h2>
            <p>
              Companies where <strong>hours are the input to pay</strong> — staffing and contract
              agencies, IT services firms billing against project time, and any distributed team
              where “was this worked?” is a question someone actually asks. That is where owning the
              chain stops being an architectural nicety and starts being the reason the month closes
              cleanly.
            </p>
            <p>
              And companies coming off a spreadsheet, for whom the realistic alternative is not a
              rival platform but five tools and a shared drive. For them the statutory engine alone
              is the argument, and the tracker is what makes the attendance behind it trustworthy.
            </p>
          </article>

          <Card className="mt-10 p-6">
            <p className="font-display text-[17px] font-bold text-n-900">
              The fastest way to test all of this
            </p>
            <p className="mt-2 text-[14px] leading-6 text-n-600">
              Run a parallel month. Process real payroll in CareVance without paying from it, then
              read the differences report against your current provider’s output. Every component
              that disagrees is listed with the reason. That is a better evaluation than any demo,
              and it is the one we would rather you ran.
            </p>
            <p className="mt-3 text-[13px] text-n-600">
              Or start smaller: the{' '}
              <Link href="/tools" className="underline underline-offset-4 hover:text-n-800">
                free calculators
              </Link>{' '}
              run the same arithmetic as the engine. Check one against your own payslip.
            </p>
          </Card>
        </Container>
      </Section>

      <ProductCta />
    </>
  );
}
