/**
 * Generates the P2 pages.
 *
 * These are real routes with real layouts and honest placeholder bodies — not
 * lorem, and not confident copy nobody has checked against the codebase. Each
 * one states plainly that its page is unfinished and points at the page that
 * actually covers the subject.
 *
 * Run once; after that these are ordinary files to edit by hand.
 *   node scripts/make-stubs.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, '../app');

const PAGES = [
  // ── Product modules that exist but whose pages are not written ──
  {
    route: 'product/core-hr',
    title: 'Core HR',
    metaTitle: 'Core HR',
    description:
      'Employee records, documents, government IDs, onboarding journeys and the exit lifecycle — built, with a marketing page still being written.',
    eyebrow: 'Core HR',
    heading: 'Records, onboarding journeys and exit — one lifecycle.',
    lede: 'Hiring opens an 18-step onboarding checklist automatically, spanning day −14 to +90 across six owner roles with blocking gates. Exit runs the same machinery in reverse: notice period, checklist, access revocation, interview, full and final settlement.',
    topic: 'core HR',
    related: 'the platform overview',
  },
  {
    route: 'product/leave',
    title: 'Leave',
    metaTitle: 'Leave',
    description:
      'Leave requests, approvals with forwarding, balances, holiday calendars and encashment into payroll.',
    eyebrow: 'Leave',
    heading: 'Requests, approvals that can be forwarded, and encashment into payroll.',
    lede: 'Leave requests approve, reject, revoke and — unusually — transfer to a different approver when the right person to decide is not the default one. Balances and holiday calendars are per organisation, and encashment flows into the payroll run with its own approval. Leave is a flat annual quota today: there is no accrual schedule and no mid-year pro-rating, and this page will say so in full when it is written.',
    topic: 'leave',
    related: 'the payroll page',
  },
  {
    route: 'product/performance',
    title: 'Performance',
    metaTitle: 'Performance',
    description: 'Review cycles, goals, check-ins, competencies and 360 aggregation.',
    eyebrow: 'Performance',
    heading: 'Cycles, goals, check-ins and 360 review aggregation.',
    lede: 'Review cycles with participants, competency ratings, goals with check-ins over time, and 360 aggregation across reviewers. Available on the Professional plan.',
    topic: 'performance',
    related: 'the platform overview',
  },
  {
    route: 'product/expenses-fbp',
    title: 'Expenses & FBP',
    metaTitle: 'Expenses & FBP',
    description:
      'Reimbursements with two-stage approval, flexible benefit plans, loans with payroll recovery, and variable pay.',
    eyebrow: 'Expenses & benefits',
    heading: 'Reimbursements, FBP, loans and variable pay — all landing in the run.',
    lede: 'Reimbursements with receipt upload and a two-stage manager-then-admin approval. Flexible benefit components allocated per employee, with claims. Loans that recover through payroll on a schedule. Variable pay rules and assignments. Each of these ends in a payroll item rather than a spreadsheet.',
    topic: 'expenses and benefits',
    related: 'the payroll page',
  },
  {
    route: 'product/reports',
    title: 'Reports & controls',
    metaTitle: 'Reports & controls',
    description:
      'Differences, negative-cost, duplicate and reconciliation reports, payroll and statutory registers, GL mapping and burn rate.',
    eyebrow: 'Reports & controls',
    heading: 'Find the mistake before the money moves.',
    lede: 'Four detective reports run against a payroll run rather than after it: what differs from last month and why, who carries a negative cost, what is duplicated, and whether the run reconciles. Then the payroll and statutory registers finance actually asks for, plus GL mapping, cost centres and burn rate.',
    topic: 'reporting',
    related: 'the payroll page',
  },
  {
    route: 'product/mobile',
    title: 'Mobile & desktop apps',
    metaTitle: 'Mobile & desktop apps',
    description:
      'The Expo mobile app, the Electron desktop tracker and the Chromium browser extension.',
    eyebrow: 'Apps',
    heading: 'Four surfaces, because the work does not all happen in a browser tab.',
    lede: 'An 18-screen mobile app covering payslips, leave, attendance, comp-off, regularisation and a manager approval inbox. An Electron desktop tracker with screenshots, OS-level idle detection and an offline disk queue. A Chromium extension supplying URL context. And the web application behind all of them.',
    topic: 'mobile and desktop apps',
    related: 'the time and attendance page',
  },

  // ── Solutions ──
  {
    route: 'solutions/staffing-agencies',
    title: 'For staffing agencies',
    metaTitle: 'HR & payroll for staffing agencies',
    description:
      'Bill what was actually worked, with the evidence attached — the strongest fit for a platform where the tracker and the payroll engine are one system.',
    eyebrow: 'Staffing & contract agencies',
    heading: 'Bill what was worked, with the evidence attached to it.',
    lede: 'This is the segment where owning the whole chain stops being an architectural nicety. When your margin is the gap between what a client is billed and what a contractor is paid, and both derive from the same hours, having the evidence and the payslip in one system is the difference between a clean month and an argument.',
    topic: 'staffing agency',
    related: 'the time and attendance page',
  },
  {
    route: 'solutions/it-services',
    title: 'For IT services',
    metaTitle: 'HR & payroll for IT services firms',
    description: 'Project time, utilisation and payroll in one ledger.',
    eyebrow: 'IT services',
    heading: 'Project time, utilisation and payroll from the same records.',
    lede: 'Projects and tasks, tracked time classified by application and URL, and a payroll run that reads the same attendance. Utilisation stops being a number someone assembles at quarter end from three exports.',
    topic: 'IT services',
    related: 'the platform overview',
  },
  {
    route: 'solutions/small-business',
    title: 'For small business',
    metaTitle: 'HR & payroll for small businesses in India',
    description: 'Your first payroll system after the spreadsheet.',
    eyebrow: 'Small business',
    heading: 'Your first payroll system after the spreadsheet.',
    lede: 'For most companies at this size the realistic alternative is not a rival platform — it is five disconnected tools and a shared drive. The statutory engine alone is usually the argument: PF, ESI, professional tax across 37 states, TDS on both regimes, and the returns generated rather than assembled.',
    topic: 'small business',
    related: 'the pricing page',
  },

  // ── Comparisons. Careful: describe OUR behaviour, never a rival's defects. ──
  {
    route: 'compare/spreadsheet-payroll',
    title: 'CareVance vs spreadsheet payroll',
    metaTitle: 'Moving off spreadsheet payroll',
    description:
      'What changes when payroll stops being a spreadsheet: statutory computation, an audit trail, and returns generated rather than assembled.',
    eyebrow: 'Comparison',
    heading: 'The most common thing we replace is a spreadsheet.',
    lede: 'Not a competitor — a workbook with a tab per month, a formula someone wrote in 2021, and a single person who understands it. This page will set out what actually changes, and where a spreadsheet is genuinely still fine.',
    topic: 'spreadsheet comparison',
    related: 'the payroll page',
  },
  {
    route: 'compare/keka-alternative',
    title: 'CareVance as a Keka alternative',
    metaTitle: 'CareVance as a Keka alternative',
    description:
      'An honest comparison, including the areas where CareVance is the weaker choice.',
    eyebrow: 'Comparison',
    heading: 'Where we fit, and where we do not.',
    lede: 'A comparison page is only useful if it is willing to lose. When this one is written it will state plainly that CareVance has no recruitment module and no SSO, and that a buyer whose evaluation turns on either should not choose us — alongside where owning the tracker-to-payslip chain is a genuine advantage.',
    topic: 'comparison',
    related: 'the “why CareVance” page, which already covers where the argument stops',
  },
  {
    route: 'compare/greythr-alternative',
    title: 'CareVance as a greytHR alternative',
    metaTitle: 'CareVance as a greytHR alternative',
    description:
      'An honest comparison, including the areas where CareVance is the weaker choice.',
    eyebrow: 'Comparison',
    heading: 'Where we fit, and where we do not.',
    lede: 'This page will compare on capability that can be verified on both sides, with dates on anything quoted. Until it is written and checked, the “why CareVance” page carries the same argument — including the gaps.',
    topic: 'comparison',
    related: 'the “why CareVance” page, which already covers where the argument stops',
  },

  // ── Company ──
  {
    route: 'resources',
    title: 'Guides',
    metaTitle: 'Guides & resources',
    description: 'Practical guides to Indian payroll and compliance.',
    eyebrow: 'Resources',
    heading: 'Guides to the things Indian payroll gets wrong.',
    lede: 'Written explanations of the rules the calculators implement — the ESI contribution period, the professional tax ceiling, the Section 87A marginal relief band, and what a residual salary component actually does.',
    topic: 'guides section',
    related: 'the free calculators, which each carry a written explanation of their rule',
  },
  {
    route: 'changelog',
    title: 'Changelog',
    metaTitle: 'Changelog',
    description: 'What shipped, and when.',
    eyebrow: 'Changelog',
    heading: 'What shipped, and when.',
    lede: 'A public record of releases. For a young product this is the most honest liveness signal available — more useful than a logo wall, and harder to fake.',
    topic: 'changelog',
    related: 'the platform overview',
  },
  {
    route: 'about',
    title: 'About',
    metaTitle: 'About CareVance',
    description: 'Who builds CareVance, and why it is built this way.',
    eyebrow: 'About',
    heading: 'Built by people who have run Indian payroll.',
    lede: 'The design decisions on this site — refusing an impossible override rather than accepting it, showing the engine value beside the applied one, publishing what is not built — all come from the same place. This page will say who, and why.',
    topic: 'about page',
    related: 'the “why CareVance” page',
  },
  {
    route: 'careers',
    title: 'Careers',
    metaTitle: 'Careers at CareVance',
    description: 'Open roles at CareVance.',
    eyebrow: 'Careers',
    heading: 'We are small, and we hire rarely.',
    lede: 'There is no open-roles list here yet, and we would rather show an empty page than a permanent “we are always hiring” that goes nowhere. If you have read the security or methodology pages and recognised how we think, write to us anyway.',
    topic: 'careers page',
    related: 'the contact page',
  },
];

const template = (p) => `import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: ${JSON.stringify(p.metaTitle)},
  description: ${JSON.stringify(p.description)},
  alternates: { canonical: ${JSON.stringify('/' + p.route)} },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={${JSON.stringify(p.eyebrow)}}
        title={${JSON.stringify(p.heading)}}
        lede={${JSON.stringify(p.lede)}}
      />
      <PlaceholderNote topic={${JSON.stringify(p.topic)}} related={${JSON.stringify(p.related)}} />
    </>
  );
}
`;

let written = 0;
let skipped = 0;

for (const page of PAGES) {
  const dir = resolve(APP, page.route);
  const file = resolve(dir, 'page.tsx');

  if (existsSync(file)) {
    skipped++;
    continue;
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(file, template(page), 'utf8');
  written++;
}

console.log(`make-stubs: wrote ${written} page(s), skipped ${skipped} that already existed.`);
