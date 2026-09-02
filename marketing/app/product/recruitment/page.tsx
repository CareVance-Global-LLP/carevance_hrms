import type { Metadata } from 'next';
import { breadcrumbSchema, faqSchema, JsonLd } from '@/lib/schema';
import { SCALE } from '@/lib/facts';
import { Container, Eyebrow, Lead, Section, SectionTitle } from '@/components/ui/primitives';
import {
  ProductHero,
  FeatureBlock,
  NotBuiltNote,
  ProductCta,
} from '@/components/product/PageParts';
import {
  HiringPipeline,
  PanelFeedback,
  OfferApproval,
  BgvConsent,
  BgvFinding,
} from '@/components/product/screens-modules';
import { Panel } from '@/components/product/Frame';

export const metadata: Metadata = {
  title: 'Hiring',
  description:
    'Openings, a configurable pipeline where every stage move is an event, interviews with panel feedback that is never averaged, offers with an approval chain, a signed offer letter on a public link, and consent-gated background verification.',
  alternates: { canonical: '/product/recruitment' },
};

const NOT_CLAIMED = [
  'A public careers page — a recruiter records candidates, they do not apply themselves',
  'Background-check vendor integration (AuthBridge, IDfy) — a human enters the findings',
  'Résumé parsing or CV scoring',
  'Job-board syndication',
  'Engagement surveys or an HR helpdesk',
];

const FAQS = [
  {
    q: 'Can candidates apply to us directly?',
    a: 'No. There is no public careers page — a recruiter creates the candidate record. Everything after that point is built: the pipeline, interviews, panel feedback, offers, the signed letter and background verification. If inbound applicant volume is your bottleneck, this is the wrong shape of product and we would rather say so here.',
  },
  {
    q: 'Why is a candidate separate from an application?',
    a: 'Because a candidate is a person and an application is one candidacy. Collapse them and the model breaks the moment somebody good applies for a second role — you either lose their history or duplicate the human. It also means a candidate email is unique per organisation rather than globally, deliberately unlike a user email, because the same person legitimately applies to two companies on this platform.',
  },
  {
    q: 'Is panel feedback averaged into a score?',
    a: 'Deliberately not. Three interviewers going two-to-one and three interviewers all lukewarm produce the same mean, and they call for completely different conversations. The summary returns the split and an explicit “is split” flag. It also distinguishes invited from submitted, so you can see that two of three have responded rather than reading a table of only the answers you happen to have.',
  },
  {
    q: 'Does a background check reject a candidate?',
    a: 'Nothing in the service touches the candidacy or moves a pipeline stage. The vocabulary is clear, discrepancy or insufficient — never pass or fail — because a name spelled differently on a certificate and a fabricated employer are both discrepancies and only a human should decide what either means.',
  },
  {
    q: 'What happens if a candidate withdraws consent mid-check?',
    a: 'Outstanding work stops and unstarted items become skipped, so the record still shows what was going to be checked and was not. Findings already obtained are not erased — they were lawfully obtained at the time, and deleting them would also delete the record that the check happened.',
  },
  {
    q: 'Who can see a completed background check?',
    a: 'It is gated on the payroll role, not the manager role the rest of recruitment uses. A completed check can carry a criminal record and a previous salary, and a hiring manager decides whether to hire without needing either.',
  },
] as const;

export default function RecruitmentPage() {
  return (
    <>
      <JsonLd schema={faqSchema(FAQS.map((f) => ({ q: f.q, a: f.a })))} />
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Product', href: '/product' },
          { label: 'Hiring', href: '/product/recruitment' },
        ])}
      />

      <ProductHero
        eyebrow="Hiring"
        title="A pipeline that can tell you how somebody got where they are."
        lede="Most applicant tracking answers “which stage is this candidate in”. The harder and more useful question is how they arrived there, who said what along the way, and who approved the offer — because that is the record you need when a hire goes wrong or a rejection is challenged."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <HiringPipeline />
          <PanelFeedback />
          <OfferApproval />
        </div>
      </ProductHero>

      {/* ── The pipeline ────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>The pipeline</Eyebrow>
            <SectionTitle className="mt-3">
              A stage move is an event, not a column.
            </SectionTitle>
            <Lead className="mt-4">
              {SCALE.recruitmentRoutes.value} endpoints, and the shape of the data is the point.
            </Lead>
          </div>

          <div className="mt-12 grid gap-16">
            <FeatureBlock
              claim="REC-04"
              eyebrow="History"
              title="Where somebody is, and how they got there, are two different facts."
              body="One column says which stage a candidacy is in. A separate event log says every transition it made, who made it and when — both written in one transaction through a single service, so a controller cannot quietly become a second pipeline. Moving backwards is allowed and recorded as such, because a forward-only pipeline gets worked around by deleting and recreating the application, which destroys exactly the history you wanted."
              points={[
                { text: 'A candidate is a person; an application is one candidacy', claim: 'REC-02' },
                { text: 'Candidate email is unique per organisation, not globally', claim: 'REC-03' },
                { text: 'Rejection keeps the stage it happened at — “rejected after the tech round” is a different fact from “rejected on the CV”', claim: 'REC-05' },
                { text: 'Funnel reporting per opening, derived from the events', claim: 'REC-07' },
              ]}
              screen={<HiringPipeline />}
            />

            <FeatureBlock
              claim="REC-08"
              flip
              eyebrow="Interviews"
              title="Panel feedback is never averaged into a number."
              body="Three interviewers going two-to-one and three all lukewarm produce the same mean, and they need completely different conversations. So the summary returns the split, and an explicit flag saying it is split, rather than a score somebody can skim past."
              points={[
                { text: 'Invited and submitted are different states — “two of three have responded”', claim: 'REC-09' },
                { text: 'Somebody who has already given feedback cannot be dropped from a panel: their verdict informed a decision that may already be taken', claim: 'REC-10' },
                { text: 'Interviews can be cancelled without deleting the feedback that existed', claim: 'REC-09' },
              ]}
              screen={<PanelFeedback />}
            />
          </div>
        </Container>
      </Section>

      {/* ── Offers ──────────────────────────────────────────────────── */}
      <Section>
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Offers</Eyebrow>
            <SectionTitle className="mt-3">
              The state machine is strict in one direction, on purpose.
            </SectionTitle>
            <Lead className="mt-4">
              An offer moves forward through approval and out to a candidate. Once the candidate has
              seen it, the money can no longer be edited in place.
            </Lead>
          </div>

          <div className="mt-12 grid gap-16">
            <FeatureBlock
              claim="REC-12"
              eyebrow="Approval"
              title="The chain records who was asked, not just who answered."
              body="Approval rows are written when the offer is submitted rather than derived at read time, because deriving them loses the question that matters. “Nobody ever asked finance” is exactly the finding an audit is looking for, and it is invisible in a model that only stores answers."
              points={[
                { text: 'An empty approver list is refused, never treated as “no approval needed”', claim: 'REC-13' },
                { text: 'One rejection returns the whole offer to draft immediately', claim: 'REC-11' },
                { text: 'Editing a sent offer is refused — withdraw and draft a revision, so the change is visible', claim: 'REC-14' },
                { text: 'Re-sending does not move sent_at; the candidate has been counting down', claim: 'REC-15' },
                { text: 'Accepting moves the candidacy to hired through the pipeline, so headcount and the offer cannot disagree', claim: 'REC-16' },
              ]}
              screen={<OfferApproval />}
            />

            <FeatureBlock
              claim="SGN-01"
              flip
              eyebrow="Signing"
              title="The token is the authentication, because a candidate is not a user."
              body="Making somebody create an account to accept a job loses offers. So the signing link carries 32 random bytes, stored only as a hash, compared in constant time, hidden on the model, and cleared in the same transaction the signature is written in — a link that still works after use can be accepted twice."
              points={[
                { text: 'Every failure returns the same 404 — wrong, expired, used or withdrawn. Distinguishing them tells an unauthenticated caller which tokens exist', claim: 'SGN-02' },
                { text: 'The document hash is taken from the UNSIGNED render — it fingerprints the letter as the candidate actually read it', claim: 'SGN-03' },
                { text: 'Typing a name is a signature. Requiring a drawn one excludes keyboard and assistive-technology users, and an untouched canvas is never stored', claim: 'SGN-04' },
                { text: 'Declining is offered on the same page — “no reply” is a worse outcome for a recruiter than a reason', claim: 'SGN-05' },
              ]}
              screen={
                <Panel label="Offer letter · candidate view">
                  <div className="p-4">
                    <p className="font-mono text-[10.5px] leading-4 text-brand-800">
                      carevance.com/offer/7f3c…a91b
                    </p>
                    <div className="mt-3 rounded-lg border border-n-200 p-3">
                      <p className="text-[12px] font-semibold text-n-900">Senior Engineer</p>
                      <p className="mt-0.5 text-[11.5px] text-n-600">
                        Annual CTC ₹14,40,000 · joining 1 October 2026
                      </p>
                    </div>
                    <div className="mt-3 grid gap-2">
                      <span className="rounded-md bg-brand-700 py-1.5 text-center text-[11.5px] font-semibold text-on-brand">
                        Accept and sign
                      </span>
                      <span className="rounded-md border border-n-300 py-1.5 text-center text-[11.5px] font-semibold text-n-700">
                        Decline, with a reason
                      </span>
                    </div>
                    <p className="mt-3 border-t border-n-200 pt-2.5 text-[11px] leading-4 text-n-600">
                      No account. No password. The link is the credential, and it stops working the
                      moment it is used.
                    </p>
                  </div>
                </Panel>
              }
            />
          </div>
        </Container>
      </Section>

      {/* ── Background verification ─────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Background verification</Eyebrow>
            <SectionTitle className="mt-3">
              Three rules here are legal, not product.
            </SectionTitle>
            <Lead className="mt-4">
              Verifying somebody without their recorded agreement is unlawful under the DPDP Act and
              most equivalents. A product that makes it easy hands its customer a liability.
            </Lead>
          </div>

          <div className="mt-12 grid gap-16">
            <FeatureBlock
              claim="BGV-01"
              eyebrow="Consent"
              title="Consent gates everything, structurally."
              body="Not as a validation rule somebody could relax — the check row holds a foreign key to the consent, so there is no state in which a check exists without one. And consent is to a SCOPE, not to “background checks”: somebody who agreed to employment verification has not agreed to a credit check, and items outside the recorded scope are refused by name."
              points={[
                { text: 'A package that gains a check next year cannot retroactively widen a consent given last year', claim: 'BGV-02' },
                { text: 'IP and user agent are recorded as evidence — a consent that cannot be produced later did not happen, as far as a regulator is concerned', claim: 'BGV-03' },
                { text: 'Withdrawal stops outstanding work but does not erase findings; unstarted items become skipped', claim: 'BGV-04' },
              ]}
              screen={<BgvConsent />}
            />

            <FeatureBlock
              claim="BGV-05"
              flip
              eyebrow="Findings"
              title="A discrepancy is not a failure."
              body="A name spelled differently on a certificate and a fabricated employer are both discrepancies, and only a human should decide what either means. So the vocabulary is clear, discrepancy or insufficient — never pass/fail — and a discrepancy requires both a claimed value and a verified one, because an accusation with no comparison behind it is one nobody can answer."
              points={[
                { text: 'Nothing here touches a candidacy or moves a pipeline stage', claim: 'BGV-06' },
                { text: 'Adverse action has to reach the person: a notice on a clear check is refused, and a candidate response before a notice is refused', claim: 'BGV-07' },
                { text: 'Gated on the payroll role, not the manager role — a completed check can carry a criminal record and a previous salary', claim: 'BGV-08' },
              ]}
              screen={<BgvFinding />}
            />
          </div>

          <div className="mt-16">
            <NotBuiltNote items={NOT_CLAIMED}>
              Hiring is the newest module here, and the gap at the front of it is the one that will
              matter most to you.
            </NotBuiltNote>
          </div>
        </Container>
      </Section>

      <ProductCta
        title="Bring the hire that went wrong."
        body="The useful test of an applicant tracking system is whether it can reconstruct a decision six months later. Ask it of ours."
      />
    </>
  );
}
