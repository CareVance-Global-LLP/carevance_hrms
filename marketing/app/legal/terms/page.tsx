import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { GST_PERCENT, TRIAL_DAYS, TRIAL_SEATS, MIN_SEATS } from '@/lib/pricing';
import { LegalPage, Pending } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of service',
  description:
    'The terms on which CareVance is provided: subscriptions and billing, what each party is responsible for, statutory compliance limits, liability, and how either side ends the agreement.',
  alternates: { canonical: '/legal/terms' },
};

export default function Terms() {
  return (
    <LegalPage
      title="Terms of service"
      href="/legal/terms"
      summary="The agreement between your organisation and CareVance. Written to be understood — where a clause protects us rather than you, it says so plainly instead of hiding behind length."
    >
      <h2>1. The agreement</h2>
      <p>
        These terms are between <Pending>registered entity name</Pending> (“CareVance”, “we”) and
        the organisation that subscribes (“you”, “Customer”). By creating a workspace or using the
        service, the person accepting confirms they are authorised to bind that organisation.
      </p>
      <p>
        Where you and we have signed a separate written agreement, that agreement takes precedence
        over these terms wherever the two conflict.
      </p>

      <h2>2. What the service is</h2>
      <p>
        CareVance is a hosted HR and payroll platform for organisations operating in India,
        comprising a web application, a mobile application, a desktop time tracker, and a browser
        extension. Features change over time; we will not remove a feature you depend on without
        notice to account administrators.
      </p>
      <p>
        <strong>What it is not.</strong> CareVance is software, not a professional service. We are
        not your accountants, your auditors, your payroll bureau or your legal advisers. We compute
        figures from the data and configuration you supply. Reviewing and approving payroll before
        it is disbursed, and filing statutory returns, remain yours.
      </p>

      <h2>3. Your account</h2>
      <ul>
        <li>You are responsible for the accuracy of the data you enter, including salary structures, statutory identifiers and bank details.</li>
        <li>You are responsible for your users’ credentials. We provide two-factor authentication and recommend enforcing it for privileged roles.</li>
        <li>You must have a lawful basis for putting employee data into the platform, and for any monitoring you enable.</li>
        <li>You must not use the service to break the law, to infringe others’ rights, or to attack the platform or other tenants.</li>
      </ul>

      <h2>4. Workforce monitoring</h2>
      <p>
        If you enable the desktop tracker or any monitoring capture, <strong>you are the data
        fiduciary for that data</strong>, not us. Under the Digital Personal Data Protection Act,
        2023, the obligation to give notice and obtain consent falls on you as the employer.
      </p>
      <p>
        We provide the machinery to discharge it — versioned notices, per-capture-type consent,
        withdrawal, refusal to capture without consent, and retention purges. You must actually use
        it. You agree to indemnify us against claims arising from monitoring you enabled without a
        lawful basis.
      </p>

      <h2>5. Subscriptions, fees and billing</h2>
      <ul>
        <li>
          Fees are as published at{' '}
          <Link href="/pricing" className="underline underline-offset-4">
            carevance.com/pricing
          </Link>{' '}
          or as set out in your order form.
        </li>
        <li>
          All fees are exclusive of <strong>{GST_PERCENT}% GST</strong>, which is charged in
          addition.
        </li>
        <li>
          Per-user plans are billed on seats, with a minimum of {MIN_SEATS}. Workspace plans are
          billed as a flat monthly fee including a stated number of seats, with additional seats
          charged at the published rate. <strong>A workspace plan’s base fee is not reduced if you
          use fewer seats than it includes.</strong>
        </li>
        <li>Annual plans are billed in advance. Monthly plans are billed each cycle in advance.</li>
        <li>
          Adding seats mid-cycle is charged pro rata. Removing seats takes effect at the next
          renewal.
        </li>
        <li>
          We may change prices with at least 30 days’ notice before your next renewal. Your current
          term is not repriced.
        </li>
        <li>
          Unpaid fees may lead to suspension after notice. We will not delete your data during a
          payment dispute.
        </li>
      </ul>

      <h2>6. Free trial</h2>
      <p>
        {TRIAL_DAYS} days, on the Basic Tracking plan, with {TRIAL_SEATS} seats and no credit card
        required. The trial is provided as-is, without warranties or support commitments. We may end
        a trial being used to attack or abuse the service. Trial data is retained for a reasonable
        period after expiry so you can convert without losing it, then deleted.
      </p>

      <h2>7. Refunds and cancellation</h2>
      <ul>
        <li>You may cancel at any time from subscription settings. Cancellation takes effect at the end of the paid term.</li>
        <li>We do not refund unused time on a term you have already begun, except where required by law or where we have materially failed to provide the service.</li>
        <li>If we terminate without cause, we refund the unused portion of prepaid fees.</li>
      </ul>

      <h2>8. Your data</h2>
      <p>
        Your data is yours. We claim no ownership of it, and we do not use it to train models or for
        any purpose other than providing and securing the service.
      </p>
      <p>
        You can export employee records, payroll runs, payslips and reports at any time while your
        subscription is active. Payslips and statutory returns download as the files you would have
        filed anyway. After termination, retention and deletion follow the{' '}
        <Link href="/legal/dpa" className="underline underline-offset-4">
          data processing addendum
        </Link>
        , subject to statutory retention we are obliged to observe.
      </p>

      <h2>9. Availability</h2>
      <p>
        We aim to keep the service available and will give notice of planned maintenance where we
        can. <strong>We do not currently offer a contractual uptime commitment or service credits</strong>,
        and we would rather state that than publish a figure we cannot yet stand behind. Enterprise
        terms may include one where separately agreed in writing.
      </p>

      <h2>10. Statutory computation — scope and limits</h2>
      <p>
        The platform computes provident fund, employee state insurance, professional tax, tax
        deducted at source, labour welfare fund and gratuity according to the rules in force as we
        understand them, and generates statutory returns in the formats the relevant portals accept.
      </p>
      <p>Three limits are worth stating explicitly, because they are real:</p>
      <ol>
        <li>
          <strong>Not every return is generated.</strong> Thirteen statutory outputs are produced
          today. Others are registered but unavailable, and the product reports them as such. The{' '}
          <Link href="/product/compliance" className="underline underline-offset-4">
            compliance page
          </Link>{' '}
          lists both sets by name.
        </li>
        <li>
          <strong>Correctness depends on your configuration.</strong> A wrong state, a missing PAN
          or an incorrect salary structure produces a wrong figure, and we cannot detect every such
          case.
        </li>
        <li>
          <strong>Statutory rules change.</strong> We update the engine as amendments take effect,
          but we do not warrant that every computation matches every authority’s interpretation on
          every date. Review before you file.
        </li>
      </ol>

      <h2>11. Third parties</h2>
      <p>
        Bank files, payment gateways and government portals are operated by third parties. We are
        not responsible for their availability, their processing times, or a rejection by them of a
        file that our system generated correctly.
      </p>

      <h2>12. Warranties</h2>
      <p>
        We warrant that we will provide the service with reasonable skill and care. Beyond that, and
        to the extent the law allows, the service is provided as-is without further warranties,
        including any implied warranty of fitness for a particular purpose.
      </p>

      <h2>13. Liability</h2>
      <p>
        Neither party excludes liability for fraud, for death or personal injury caused by
        negligence, or for anything else that cannot lawfully be excluded.
      </p>
      <p>
        Subject to that, and to the extent the law allows: neither party is liable for indirect or
        consequential loss, or for loss of profit, revenue, goodwill or anticipated savings; and{' '}
        <strong>our total aggregate liability is limited to the fees you paid us in the twelve
        months before the claim arose</strong>.
      </p>
      <p>
        This is a cap that protects us, and it is why clause 10 asks you to review payroll before
        disbursing it. A payroll error found before the money moves costs a correction; found after,
        it costs a recovery — and the reports exist so it is found before.
      </p>

      <h2>14. Confidentiality</h2>
      <p>
        Each party will protect the other’s confidential information with at least the care it
        applies to its own, and will use it only to perform this agreement. This survives
        termination.
      </p>

      <h2>15. Suspension and termination</h2>
      <ul>
        <li>Either party may terminate for convenience at the end of a paid term.</li>
        <li>Either party may terminate immediately for a material breach that is not cured within 30 days of notice.</li>
        <li>We may suspend immediately, with notice as soon as practicable, where continued use threatens the platform’s security or other customers.</li>
      </ul>

      <h2>16. Changes to these terms</h2>
      <p>
        We may update these terms. Material changes will be posted here with a new effective date
        and notified to account administrators at least 30 days in advance. If a change materially
        disadvantages you, you may terminate before it takes effect and receive a refund of prepaid
        fees for the unused period.
      </p>

      <h2>17. Governing law</h2>
      <p>
        These terms are governed by the laws of India, and the courts at{' '}
        <Pending>jurisdiction city</Pending> have exclusive jurisdiction.
      </p>

      <h2>18. Contact</h2>
      <p>
        <a href={`mailto:${SITE.salesEmail}`} className="underline underline-offset-4">
          {SITE.salesEmail}
        </a>{' '}
        for commercial questions,{' '}
        <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
          {SITE.supportEmail}
        </a>{' '}
        for everything else.
      </p>
    </LegalPage>
  );
}
