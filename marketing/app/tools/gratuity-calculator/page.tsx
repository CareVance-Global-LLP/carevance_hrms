import type { Metadata } from 'next';
import { ToolPage } from '@/components/tools/ToolPage';
import { GratuityCalculator } from '@/components/tools/GratuityCalculator';

export const metadata: Metadata = {
  title: 'Gratuity calculator',
  description:
    'Gratuity under the Payment of Gratuity Act, with the five-year service floor and the ₹20,00,000 statutory ceiling both applied — the two rules most calculators skip.',
  alternates: { canonical: '/tools/gratuity-calculator' },
};

const FAQS = [
  {
    q: 'Do I get gratuity if I leave before five years?',
    a: 'No. Five years of continuous service is a statutory precondition, and below it there is no entitlement at all. The exception is death or disablement, where the five-year requirement does not apply. Calculators that show you a number regardless are telling leavers they are owed money they are not.',
  },
  {
    q: 'Does four years and seven months count as five?',
    a: 'In many cases yes. Courts have held that a year of service means 240 working days, so four years and 240 days in the fifth year has been treated as five years. It depends on your employer’s reading and on your state’s case law, so it is worth asking rather than assuming either way.',
  },
  {
    q: 'Why is it divided by 26?',
    a: 'The Act assumes a 26-day working month — six days a week, excluding Sundays. Fifteen days’ wages therefore means (Basic + DA) × 15 ÷ 26 for each completed year, not half a month’s salary.',
  },
  {
    q: 'Is gratuity taxable?',
    a: 'For employees covered by the Act, gratuity is exempt up to ₹20,00,000 across your entire career, not per employer. Anything above that lifetime limit is taxable as salary. If you have received gratuity before, your remaining exemption is reduced by what you already used.',
  },
  {
    q: 'Is gratuity computed on gross salary?',
    a: 'No — on Basic plus Dearness Allowance only. Using gross would overstate it substantially, since HRA, conveyance and special allowance are all excluded.',
  },
] as const;

export default function Page() {
  return (
    <ToolPage
      title="Gratuity calculator"
      href="/tools/gratuity-calculator"
      eyebrow="Free calculator"
      lede="Fifteen days’ wages for every completed year — with the five-year floor and the ₹20,00,000 ceiling both applied. Those two rules decide most real answers, and most calculators skip at least one."
      calculator={<GratuityCalculator />}
      provenance="PayrollCalculatorService::calculateGratuityForSettlement — the guarded path, which enforces GRATUITY_MIN_YEARS (5) and GRATUITY_MAX_PAYOUT (₹20,00,000). The engine also has a raw function that applies neither; the product deliberately routes settlements through the guarded one."
      faqs={FAQS}
      related={[
        { href: '/tools/take-home-salary-calculator', label: 'Take-home salary' },
        { href: '/tools/salary-breakup-calculator', label: 'Salary breakup' },
      ]}
      explanation={
        <>
          <h2>The formula, and the two rules around it</h2>
          <p>
            Gratuity is <strong>(Basic + DA) × 15 × years of service ÷ 26</strong>. That much is
            widely known. What decides most real answers is the two rules that sit around the
            formula rather than inside it.
          </p>
          <p>
            <strong>The five-year floor.</strong> Below five years of continuous service there is
            no entitlement whatsoever. Not a reduced amount — nothing. The formula will happily
            produce a number for four years of service, and that number is meaningless.
          </p>
          <p>
            <strong>The statutory ceiling.</strong> A gratuity payout is capped at ₹20,00,000. For
            a long-serving senior employee the formula can exceed that comfortably, and the excess
            is simply not payable as gratuity.
          </p>

          <h2>Why the product has two functions for this</h2>
          <p>
            The CareVance engine exposes a raw gratuity calculation and a settlement calculation.
            The raw one applies neither rule, because it is used to compute the monthly provision
            an employer accrues — an accounting figure, not an entitlement. The settlement one
            applies both, because it produces the number a leaver is actually paid.
          </p>
          <p>
            Full and final settlements go through the guarded path. This calculator mirrors it, so
            what you see here is what a leaver would receive rather than what the formula alone
            would suggest.
          </p>
        </>
      }
    />
  );
}
