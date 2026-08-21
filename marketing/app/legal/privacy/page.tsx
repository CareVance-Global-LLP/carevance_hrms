import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { LegalPage, Pending } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'How CareVance collects, uses and protects personal data — including the workforce monitoring data the desktop tracker captures, and your rights under the Digital Personal Data Protection Act, 2023.',
  alternates: { canonical: '/legal/privacy' },
};

export default function PrivacyPolicy() {
  return (
    <LegalPage
      title="Privacy policy"
      href="/legal/privacy"
      summary="How we handle personal data — both the data you give us as a customer, and the employee data your workspace processes through us. Written to be read rather than to be survived."
    >
      <h2>1. Who this covers, and in what capacity</h2>
      <p>
        CareVance is operated by <Pending>registered entity name</Pending>, registered at{' '}
        <Pending>registered address</Pending> (“CareVance”, “we”, “us”).
      </p>
      <p>
        We act in two different capacities, and the distinction matters because it determines who is
        answerable to whom:
      </p>
      <ul>
        <li>
          <strong>As a data fiduciary</strong> for the personal data of the people who sign up for,
          buy, or enquire about CareVance — names, work email addresses, billing details, support
          correspondence.
        </li>
        <li>
          <strong>As a data processor</strong> for the employee data your organisation puts into
          the platform. Your employer is the fiduciary for that data; we process it on their
          instructions. If you are an employee and want your data corrected or erased, your
          employer decides — start with them, and we will support whatever they instruct.
        </li>
      </ul>

      <h2>2. What we collect</h2>
      <h3>From customers and prospects</h3>
      <ul>
        <li>Account details: name, work email, organisation name, role.</li>
        <li>
          Billing details, processed through our payment provider. We do not store full card
          numbers.
        </li>
        <li>Support and sales correspondence.</li>
        <li>
          Product usage and diagnostic logs — which features are used, and errors encountered.
        </li>
      </ul>

      <h3>From your employees, on your instructions</h3>
      <ul>
        <li>
          Employment records: name, employee code, designation, department, joining date, reporting
          line.
        </li>
        <li>
          Statutory identifiers where you provide them: PAN, UAN, ESI number, Aadhaar where legally
          required for a filing.
        </li>
        <li>Bank account details, for salary disbursement.</li>
        <li>Payroll data: salary structure, deductions, payslips, tax declarations and proofs.</li>
        <li>Attendance, leave, shift and overtime records.</li>
        <li>
          <strong>Workforce monitoring data, where your organisation enables it:</strong> periodic
          screenshots, foreground application and browser URL context, idle intervals, location at
          punch-in where geofencing is used, and attendance selfies.
        </li>
      </ul>

      <h2>3. Workforce monitoring, specifically</h2>
      <p>
        This deserves its own section rather than a line in a list, because it is the most intrusive
        thing the platform does.
      </p>
      <p>
        Monitoring capture is gated on notice and consent. Every capture path — screenshots,
        activity, geofenced punches, attendance selfies — passes through a single check before
        anything is recorded. Notices are versioned and are never edited in place, so what a person
        agreed to remains recoverable. Consent is recorded per capture type, together with the
        request context, and it can be withdrawn. Where consent has not been given and the
        collection window has closed, capture is refused rather than performed quietly.
      </p>
      <p>
        <strong>What the tracker does not do:</strong> it does not record video of your screen, it
        does not log keystrokes, it does not read the contents of documents or messages, and it does
        not run when the employer has not enabled it. Screenshots are periodic still images.
      </p>
      <p>
        Screenshots are subject to a scheduled retention purge. Your employer sets that retention
        period, and under the DPDP Act it is your employer who carries the obligation to give notice
        — which is why the tooling to manage it ships with the product.
      </p>

      <h2>4. Why we process it</h2>
      <ul>
        <li>To provide the service you or your employer signed up for.</li>
        <li>
          To meet legal obligations — statutory returns, tax filings and record retention required
          under Indian law.
        </li>
        <li>To bill you, and to recover amounts due.</li>
        <li>To secure the platform, investigate abuse and diagnose faults.</li>
        <li>To respond when you contact us.</li>
      </ul>
      <p>
        We do not sell personal data. We do not share it with advertising networks. We do not use
        your employees’ payroll data to train models.
      </p>

      <h2>5. Who we share it with</h2>
      <ul>
        <li>
          <strong>Infrastructure and hosting providers</strong>, to run the service.
        </li>
        <li>
          <strong>Payment providers</strong>, to take payment from you.
        </li>
        <li>
          <strong>Banks</strong>, when your workspace generates a disbursement file — and only the
          fields that file requires.
        </li>
        <li>
          <strong>Government portals</strong>, when your workspace generates a statutory return.
        </li>
        <li>
          <strong>Authorities</strong>, where we are legally compelled. Where we are permitted to
          tell you, we will.
        </li>
      </ul>
      <p>
        Sub-processors are listed in the{' '}
        <Link href="/legal/dpa" className="underline underline-offset-4">
          data processing addendum
        </Link>
        , which is the document that binds them.
      </p>

      <h2>6. Where it is stored</h2>
      <p>
        Data is hosted at <Pending>hosting region</Pending>. Where any processing occurs outside
        India, it is covered by contractual protections in the data processing addendum.
      </p>

      <h2>7. How long we keep it</h2>
      <ul>
        <li>
          <strong>Account and billing records:</strong> for the life of the account, then as long as
          tax and company law require.
        </li>
        <li>
          <strong>Payroll records:</strong> for the statutory retention period applicable to payroll
          and tax records in India, because deleting them earlier would leave you unable to answer a
          notice.
        </li>
        <li>
          <strong>Screenshots and monitoring data:</strong> per your organisation’s configured
          retention, enforced by a scheduled purge.
        </li>
        <li>
          <strong>After termination:</strong> as set out in the data processing addendum. We will
          return or delete customer data on instruction, subject to the statutory retention above.
        </li>
      </ul>

      <h2>8. Your rights</h2>
      <p>Under the Digital Personal Data Protection Act, 2023 you may:</p>
      <ul>
        <li>Ask what personal data we hold about you and how it is processed.</li>
        <li>Ask us to correct data that is inaccurate or incomplete.</li>
        <li>Ask us to erase data we no longer need or are not required to keep.</li>
        <li>Withdraw a consent you gave, including consent to monitoring capture.</li>
        <li>Nominate someone to exercise these rights if you are unable to.</li>
        <li>Raise a grievance, and escalate it to the Data Protection Board of India.</li>
      </ul>
      <p>
        Write to{' '}
        <a href={`mailto:${SITE.privacyEmail}`} className="underline underline-offset-4">
          {SITE.privacyEmail}
        </a>
        . If you are an employee of a CareVance customer, we will route your request to your
        employer, who is the fiduciary for that data, and act on their instruction.
      </p>

      <h2>9. Grievance officer</h2>
      <p>
        Grievance Officer: <Pending>name</Pending>, <Pending>designation</Pending>, contactable at{' '}
        <a href={`mailto:${SITE.privacyEmail}`} className="underline underline-offset-4">
          {SITE.privacyEmail}
        </a>
        . We acknowledge grievances within 72 hours and aim to resolve them within 30 days.
      </p>

      <h2>10. Security</h2>
      <p>
        Encryption in transit and at rest, tenant isolation enforced at the data-access layer and
        covered by an automated test, role-based access controls, optional enforced two-factor
        authentication, break-glass sessions that are recorded, and append-only audit trails on
        payroll changes.
      </p>
      <p>
        We do not hold a SOC 2 report or an ISO 27001 certificate. The{' '}
        <Link href="/security" className="underline underline-offset-4">
          security page
        </Link>{' '}
        states in full what is implemented and what is not.
      </p>

      <h2>11. Children</h2>
      <p>
        CareVance is workplace software and is not directed at children. We do not knowingly collect
        data from anyone under 18 other than as part of an employment record lawfully created by an
        employer.
      </p>

      <h2>12. Changes</h2>
      <p>
        We will post material changes here with a new effective date and notify account
        administrators before they take effect. Continued use after that date means the updated
        policy applies.
      </p>

      <h2>13. Contact</h2>
      <p>
        Privacy:{' '}
        <a href={`mailto:${SITE.privacyEmail}`} className="underline underline-offset-4">
          {SITE.privacyEmail}
        </a>
        . Security reports:{' '}
        <a href="mailto:security@carevance.com" className="underline underline-offset-4">
          security@carevance.com
        </a>
        . Everything else:{' '}
        <a href={`mailto:${SITE.supportEmail}`} className="underline underline-offset-4">
          {SITE.supportEmail}
        </a>
        .
      </p>
    </LegalPage>
  );
}
