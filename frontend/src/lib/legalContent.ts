import { legalLabel, legalProductLabel } from '@/config/brand';
export interface LegalSection {
  id: string;
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

/**
 * Placeholder legal copy for pre-launch implementation only.
 * This content must be reviewed and replaced by qualified legal counsel before production launch.
 */
export const legalReviewNotice =
  'This legal copy is a launch-preparation placeholder and must be reviewed by qualified legal counsel before production use.';

export const privacyPolicySections: LegalSection[] = [
  {
    id: 'overview',
    heading: 'Company and product overview',
    paragraphs: [
      `${legalProductLabel} provides workforce management, attendance, reporting, payroll support, onboarding, and related operations tooling for organizations and invited team members.`,
      'This placeholder Privacy Policy explains the kinds of data the product may process and the baseline operational expectations that should be legally reviewed before launch.',
    ],
  },
  {
    id: 'information-collected',
    heading: 'Information collected',
    paragraphs: [
      'We may collect account details, organization details, billing intent details, invite data, device information, support submissions, and usage data needed to deliver the service.',
      'Depending on workspace configuration, organizations may also process employee operations data such as attendance records, task activity, productivity signals, screenshots, reports, and payroll-related information.',
    ],
    bullets: [
      'Account profile details such as name, email address, role, and organization membership',
      'Operational records such as invites, attendance, time entries, approvals, reports, and settings',
      'Technical information such as browser, device, IP address, and diagnostic logs needed for service reliability',
      'Support and bug-report details that users voluntarily submit',
    ],
  },
  {
    id: 'information-use',
    heading: 'How information is used',
    paragraphs: [
      'Information may be used to create and secure accounts, operate workspace functionality, provide customer support, process onboarding and billing workflows, improve product reliability, and communicate service-related notices.',
      'Any analytics, advertising, or non-essential tracking should remain subject to user consent and legal review before being enabled in production.',
    ],
  },
  {
    id: 'cookies',
    heading: 'Cookies and tracking technologies',
    paragraphs: [
      `${legalLabel} may use essential browser storage and cookies required for authentication, preferences, security, and core product delivery.`,
      'Non-essential analytics or marketing technologies should only be enabled after consent is collected and the organization has approved an appropriate privacy posture.',
    ],
  },
  {
    id: 'retention',
    heading: 'Retention',
    paragraphs: [
      'Data may be retained for as long as needed to operate the service, comply with legal obligations, resolve disputes, enforce agreements, and support customer reporting or audit needs.',
      "Retention schedules and deletion commitments should be reviewed and finalized before launch according to your organization's regulatory obligations and internal policy.",
    ],
  },
  {
    id: 'third-parties',
    heading: 'Third-party services',
    paragraphs: [
      `${legalLabel} may rely on third-party providers for hosting, email delivery, analytics, payment processing, customer support, and infrastructure monitoring.`,
      'Those providers may process data on our behalf under their own contractual and legal terms, which should be reviewed during launch preparation.',
    ],
  },
  {
    id: 'contact',
    heading: 'Contact information',
    paragraphs: [
      `Questions about privacy practices, data handling, or legal terms should be directed to the designated ${legalLabel} support or privacy contact configured for your production environment.`,
      legalReviewNotice,
    ],
  },
];

export const termsAndConditionsSections: LegalSection[] = [
  {
    id: 'overview',
    heading: 'Company and product overview',
    paragraphs: [
      `These placeholder Terms & Conditions describe the baseline rules for accessing ${legalProductLabel}, including owner signup, invite-only onboarding, reporting, payroll support workflows, and connected workforce operations features.`,
      'They are provided to support pre-launch implementation only and must be reviewed by qualified legal counsel before production use.',
    ],
  },
  {
    id: 'account-responsibilities',
    heading: 'Account responsibilities',
    paragraphs: [
      'Workspace owners and invited users are responsible for maintaining the confidentiality of account credentials, providing accurate information, and using the service only as authorized by their organization.',
      'Organizations are responsible for determining whether their monitoring, payroll, attendance, and employee-data practices are lawful in the jurisdictions where they operate.',
    ],
  },
  {
    id: 'acceptable-use',
    heading: 'Acceptable use',
    paragraphs: [
      `Users may not misuse the service, interfere with platform stability, attempt unauthorized access, upload malicious content, or use ${legalLabel} in violation of law, employment rules, or third-party rights.`,
    ],
    bullets: [
      'Do not share credentials or impersonate another user',
      'Do not reverse engineer, disrupt, or abuse the platform',
      'Do not upload unlawful, infringing, or malicious content',
      'Do not use workforce monitoring features without lawful notice, consent, or policy approval where required',
    ],
  },
  {
    id: 'billing',
    heading: 'Payment and billing terms',
    paragraphs: [
      'Paid plans, trial periods, renewals, payment processor terms, invoice obligations, and refunds should be governed by finalized commercial terms before production launch.',
      'Where a trial or billing intent is captured before checkout is enabled, that state should not be treated as a finalized commercial agreement until your production billing flow and legal terms are approved.',
    ],
  },
  {
    id: 'third-parties',
    heading: 'Third-party services',
    paragraphs: [
      'Use of integrations, payment processors, email providers, analytics tools, hosting providers, or other third-party infrastructure may be subject to additional terms and privacy obligations.',
    ],
  },
  {
    id: 'liability',
    heading: 'Limitation of liability',
    paragraphs: [
      'Any limitation of liability, warranty disclaimer, indemnity language, and governing-law clause must be finalized by legal counsel before launch.',
      'Until that review occurs, this placeholder section should not be relied upon as a completed legal agreement.',
    ],
  },
  {
    id: 'contact',
    heading: 'Contact information',
    paragraphs: [
      `Questions about these terms, commercial arrangements, or compliance obligations should be directed to the designated ${legalLabel} support or legal contact configured for production.`,
      legalReviewNotice,
    ],
  },
];
