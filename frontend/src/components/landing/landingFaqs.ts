/**
 * The eight questions a buyer actually asks, and honest answers to them.
 *
 * These replaced the billing FAQ on the homepage. Billing questions belong on
 * /pricing, where somebody has already decided the product might work; the
 * homepage has to answer the objections that stop them getting that far.
 *
 * TWO RULES FOR EDITING THIS FILE.
 *
 * 1. Every claim traces to PRODUCT_TRUTH.md. If an answer states a count, a
 *    format or a rule, it is because that file records where it was counted
 *    from. Do not add a number here that is not in there.
 *
 * 2. "What is not built yet" stays, and stays current. A gap list is the single
 *    highest-trust thing on a page from a company with no logo wall — and a
 *    stale one is worse than none, because a technical buyer checks it. When a
 *    gap closes, delete the line in the same commit that closes it.
 *
 * These are rendered as an accordion AND emitted as FAQPage structured data, so
 * an answer edited here changes both. Google reads the markup; keep the answers
 * self-contained rather than referring to "the section above".
 */

export interface LandingFaq {
  question: string;
  answer: string;
}

export const landingFaqs: readonly LandingFaq[] = [
  {
    question: 'Do I have to use the desktop tracker to run payroll?',
    answer:
      'No. Payroll works from attendance records however they were created — web check-in, mobile punch, biometric terminal, or imported. The tracker makes the attendance better and gives you evidence behind every hour, but it is not a precondition for running payroll.',
  },
  {
    question: 'Is employee monitoring legal in India, and how do employees feel about it?',
    answer:
      'Monitoring runs on notice and consent, enforced at a single gate every capture path passes through. Notices are versioned and never edited in place, consent is recorded per capture type, and it can be withdrawn — after which the capture is refused rather than taken and hidden. Under the DPDP Act the liability for collecting without notice falls on the employer, so those controls ship with the product rather than being left to you to build.',
  },
  {
    question: 'Which statutory documents can you actually produce?',
    answer:
      'Twenty-three, and nineteen of them are returns: PF ECR, Full ECR, ESI Challan, Form 24Q, PT Return, LWF Return, Bonus Forms C, D and E, Form 12BA, Form 16, Form 16 Annual, Form 19, Form 31, Form 2, Form 6 and Form 124. The other four — e-SHRAM, Shram card, S&E registration and Form 1 — are preparation sheets rather than returns, and say so on their face. Nothing auto-submits: every filing is a document a human uploads to the portal.',
  },
  {
    question: 'Do you handle professional tax correctly across states?',
    answer:
      'Professional tax is resolved across 37 states and union territories, of which 20 actually levy it. A state that levies none returns ₹0 rather than falling back to a neighbour’s slab — defaulting an unset state to a real one is how a deduction ends up on a payslip that no authority will ever collect. Maharashtra’s higher February instalment is modelled too.',
  },
  {
    question: 'Can I audit the payroll engine before trusting it with real money?',
    answer:
      'That is what a parallel run is for. Process a month in CareVance without paying from it, then compare against your current provider’s output using the differences report. Every component that disagrees is listed with the reason it moved, including the specific override that caused it and who approved that override.',
  },
  {
    question: 'What is not built yet?',
    answer:
      'No public careers page — a recruiter records candidates rather than them applying themselves. No background-check vendor integration, so findings are entered by a human. SCIM syncs people but not groups, so roles do not sync. The roster has no drag-and-drop calendar. Biometric ingestion is ADMS push only, so devices that only offer SDK pull cannot talk to it. Accounting export produces a Tally or Zoho file to import rather than posting over an API. No travel expense module, no engagement surveys, no helpdesk. Chat polls rather than pushing in real time, and there is no i18n layer — English only.',
  },
  {
    question: 'Are you SOC 2 or ISO 27001 certified?',
    answer:
      'No, to both, and we do not represent otherwise. There is no published uptime figure or SLA either. What is true: tenant isolation is applied at the ORM layer across the data model and a test fails the build if a tenant-owned model lapses; two-factor authentication is enforceable per organisation; access is role-based with payroll routes gated and asserted by tests; break-glass elevation is a recorded session; and audit trails are append-only. If your procurement process requires a SOC 2 report, we cannot satisfy it today.',
  },
  {
    question: 'How hard is it to move off my current payroll provider?',
    answer:
      'The objection is never the product, it is the migration — so the shape of it is: import employees and salary structures by CSV with government ID and bank-detail validation running as you go, run a parallel month against your existing payroll and reconcile the differences report, then go live and roll the desktop tracker out afterwards. Payroll works without the tracker, so those two moves do not have to happen in the same week.',
  },
];

/** FAQPage structured data. Emitted from the landing page's JSON-LD block. */
export function faqPageSchema(faqs: readonly LandingFaq[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}
