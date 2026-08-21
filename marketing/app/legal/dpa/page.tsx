import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { LegalPage, Pending } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Data processing addendum',
  description:
    'The terms on which CareVance processes employee personal data on your instructions: scope, sub-processors, security measures, breach notification, and what happens to data when the agreement ends.',
  alternates: { canonical: '/legal/dpa' },
};

export default function Dpa() {
  return (
    <LegalPage
      title="Data processing addendum"
      href="/legal/dpa"
      summary="Where the privacy policy explains what we do, this is the contract that binds us to it. It forms part of the terms of service and applies whenever we process employee personal data on your instructions."
    >
      <h2>1. Scope and roles</h2>
      <p>
        This addendum forms part of the{' '}
        <Link href="/legal/terms" className="underline underline-offset-4">
          terms of service
        </Link>{' '}
        between <Pending>registered entity name</Pending> (“Processor”, “we”) and the Customer
        (“Fiduciary”, “you”).
      </p>
      <p>
        For the personal data of your employees, <strong>you are the data fiduciary and we are the
        data processor</strong>. You determine why and how it is processed; we act on your
        documented instructions, which include your configuration of the platform and your use of
        its features.
      </p>
      <p>
        If we believe an instruction breaches applicable data protection law, we will tell you
        rather than silently execute it.
      </p>

      <h2>2. Subject matter and duration</h2>
      <p>
        We process personal data for as long as your subscription is active, and afterwards only as
        clause 9 permits.
      </p>

      <h2>3. Categories of data subject</h2>
      <ul>
        <li>Your employees, past and present</li>
        <li>Your contractors and consultants, where you record them in the platform</li>
        <li>Your administrative users</li>
      </ul>

      <h2>4. Categories of personal data</h2>
      <ul>
        <li>
          <strong>Identity and employment:</strong> name, employee code, designation, department,
          joining and exit dates, reporting line, contact details.
        </li>
        <li>
          <strong>Statutory identifiers:</strong> PAN, UAN, ESI number, and Aadhaar where you supply
          it for a filing that legally requires it.
        </li>
        <li>
          <strong>Financial:</strong> salary structure, payroll items, deductions, payslips, tax
          declarations and supporting proofs, bank account details, loans and reimbursements.
        </li>
        <li>
          <strong>Time and attendance:</strong> attendance records, leave, shifts, overtime,
          regularisation requests.
        </li>
        <li>
          <strong>Monitoring data, where you enable it:</strong> periodic screenshots, foreground
          application and browser URL context, idle intervals, geolocation at punch-in, attendance
          selfies.
        </li>
      </ul>
      <p>
        Tax proofs and statutory identifiers may include data you consider sensitive. Monitoring
        data is capable of revealing a great deal about an individual, which is why clause 6 treats
        it separately.
      </p>

      <h2>5. Our obligations</h2>
      <ul>
        <li>Process personal data only on your documented instructions.</li>
        <li>Ensure personnel with access are bound by confidentiality.</li>
        <li>Implement the security measures in clause 7.</li>
        <li>Not engage a sub-processor except under clause 8.</li>
        <li>Assist you, so far as we reasonably can, with data subject requests, impact assessments and consultations with the Data Protection Board.</li>
        <li>Notify you of a personal data breach as set out in clause 10.</li>
        <li>Make available the information reasonably necessary to demonstrate compliance with this addendum.</li>
        <li>Delete or return personal data as set out in clause 9.</li>
      </ul>

      <h2>6. Monitoring data</h2>
      <p>
        Where you enable workforce monitoring, <strong>you remain the fiduciary</strong>. The
        obligation to give notice and obtain consent under the Digital Personal Data Protection Act,
        2023 is yours.
      </p>
      <p>We provide, and you agree to use, the following controls:</p>
      <ul>
        <li>A monitoring notice, versioned and never edited in place, so a published version stays recoverable.</li>
        <li>Consent recorded per capture type, with request context.</li>
        <li>Withdrawal of consent, after which capture of that type stops.</li>
        <li>Refusal to capture where consent has not been given and the collection window has closed.</li>
        <li>A configurable retention period for screenshots, enforced by a scheduled purge.</li>
      </ul>
      <p>
        We do not use monitoring data for any purpose other than providing the service to you. We do
        not analyse it across customers, and we do not use it to train models.
      </p>

      <h2>7. Security measures</h2>
      <ul>
        <li>Encryption of personal data in transit and at rest.</li>
        <li>
          <strong>Tenant isolation enforced at the data-access layer</strong>, applied by default to
          every query on tenant-owned records, with an automated test that fails the build if a
          model is added without it.
        </li>
        <li>Role-based access control, with route-level authorisation covered by tests.</li>
        <li>Two-factor authentication, which you may enforce organisation-wide, including mandatory enrolment for privileged roles.</li>
        <li>Elevated support access opens a recorded break-glass session with a defined beginning and end.</li>
        <li>Append-only audit trails on payroll changes and override decisions.</li>
        <li>Rate limiting on authentication endpoints.</li>
        <li>Input sanitisation on user-supplied content.</li>
      </ul>
      <p>
        We do not hold a SOC 2 report or an ISO 27001 certificate, and we do not represent otherwise
        in this addendum or anywhere else. The{' '}
        <Link href="/security" className="underline underline-offset-4">
          security page
        </Link>{' '}
        is kept current and dated.
      </p>

      <h2>8. Sub-processors</h2>
      <p>
        You authorise us to engage sub-processors to provide the service. Each is bound by
        obligations no less protective than those in this addendum, and we remain liable to you for
        their performance.
      </p>
      <p>
        Current sub-processors: <Pending>hosting provider</Pending> (infrastructure hosting,{' '}
        <Pending>region</Pending>), <Pending>payment provider</Pending> (payment processing),{' '}
        <Pending>email provider</Pending> (transactional email),{' '}
        <Pending>push provider</Pending> (mobile push notifications).
      </p>
      <p>
        We will give at least 30 days’ notice before adding or replacing a sub-processor. If you
        reasonably object on data protection grounds, tell us within that period and we will work
        with you in good faith; if we cannot resolve it, you may terminate the affected service and
        receive a refund of prepaid fees for the unused period.
      </p>

      <h2>9. Return and deletion</h2>
      <ul>
        <li>While your subscription is active, you can export your data at any time.</li>
        <li>
          On termination, we will delete or return personal data on your written instruction within{' '}
          <strong>60 days</strong>.
        </li>
        <li>
          We will retain data beyond that only where Indian law requires it — principally payroll
          and tax records subject to statutory retention. Retained data stays protected by this
          addendum and is not processed for any other purpose.
        </li>
        <li>Backups are purged on their ordinary rotation cycle.</li>
      </ul>

      <h2>10. Breach notification</h2>
      <p>
        We will notify you <strong>without undue delay, and in any event within 72 hours</strong> of
        becoming aware of a personal data breach affecting your data. The notification will describe
        the nature of the breach, the categories and approximate volume of data and data subjects
        affected, the likely consequences, and the measures taken or proposed.
      </p>
      <p>
        Where we do not have all of that at first, we will send what we do have and follow up rather
        than delay the initial notice. We will assist you with any notification you are required to
        make to the Data Protection Board or to affected individuals.
      </p>

      <h2>11. Data subject requests</h2>
      <p>
        Where an individual contacts us directly about data we process on your behalf, we will not
        respond substantively; we will refer them to you and tell you promptly. We will assist you
        in responding, including by providing export and deletion tooling.
      </p>

      <h2>12. Audit</h2>
      <p>
        We will provide the information reasonably necessary to demonstrate compliance with this
        addendum. Where you require an on-site or third-party audit, we will discuss scope, timing
        and cost in good faith; audits are limited to once per twelve months absent a breach or a
        regulator’s requirement.
      </p>

      <h2>13. International transfers</h2>
      <p>
        Personal data is hosted at <Pending>hosting region</Pending>. Where processing occurs
        outside India, we will ensure an appropriate transfer mechanism consistent with applicable
        law is in place before the transfer.
      </p>

      <h2>14. Liability and precedence</h2>
      <p>
        Liability under this addendum is subject to the limitations in the terms of service. Where
        this addendum conflicts with those terms on the processing of personal data, this addendum
        prevails.
      </p>

      <h2>15. Signing this addendum</h2>
      <p>
        This addendum applies automatically to every customer, with no signature required. If your
        procurement process needs a countersigned copy, write to{' '}
        <a href={`mailto:${SITE.privacyEmail}`} className="underline underline-offset-4">
          {SITE.privacyEmail}
        </a>{' '}
        and we will provide one.
      </p>
    </LegalPage>
  );
}
