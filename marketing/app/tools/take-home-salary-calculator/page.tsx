import type { Metadata } from 'next';
import { ToolPage } from '@/components/tools/ToolPage';
import { TakeHomeCalculator } from '@/components/tools/TakeHomeCalculator';

export const metadata: Metadata = {
  title: 'Take-home salary calculator',
  description:
    'What actually reaches your bank account after PF, professional tax, ESI and income tax — with the old and new regimes computed side by side and the cheaper one named.',
  alternates: { canonical: '/tools/take-home-salary-calculator' },
};

const FAQS = [
  {
    q: 'Which tax regime should I choose?',
    a: 'Whichever costs less, which depends entirely on your deductions. The new regime has lower rates and a ₹75,000 standard deduction but allows nothing else — no HRA exemption, no 80C, no 80D, no home-loan interest. The old regime has higher rates but permits all of those. This calculator computes both and names the cheaper one, which is what the product’s own regime simulator does.',
  },
  {
    q: 'Why is my TDS not simply one-twelfth of the annual tax?',
    a: 'A correct payroll engine computes TDS cumulatively — it works out your tax for the year to date, subtracts what has already been deducted, and deducts the difference. That is why your TDS changes when you submit investment proofs or get a raise mid-year, rather than staying flat and leaving a large correction in March.',
  },
  {
    q: 'Is ESI deducted from my salary?',
    a: 'Only if your monthly gross is ₹21,000 or below. Above that you are outside the scheme. One nuance most tools miss: coverage is fixed for a whole contribution period — April to September, or October to March — so if you were covered when a period began you stay covered until it ends, even if a raise takes you over the threshold in month three.',
  },
  {
    q: 'Why is professional tax zero for my state?',
    a: 'Professional tax is levied by states rather than by the union, and 17 of the 37 states and union territories do not levy it at all. Zero is the correct answer in those, and the calculator says so explicitly rather than silently omitting the row.',
  },
  {
    q: 'Does this include employer PF?',
    a: 'It is shown as part of CTC but not deducted from your take-home, because it is not your money passing through — it is an employer cost that goes into your PF account. Your own 12% contribution is deducted and is included here.',
  },
] as const;

export default function Page() {
  return (
    <ToolPage
      title="Take-home salary calculator"
      href="/tools/take-home-salary-calculator"
      eyebrow="Free calculator"
      lede="What actually lands in your account, after provident fund, professional tax, ESI and income tax — with both tax regimes computed side by side so you can see which one you should be on."
      calculator={<TakeHomeCalculator />}
      provenance="PF, ESI and structure logic from PayrollCalculatorService; professional tax from PTStateService across all 37 states and union territories; income tax on FY 2025-26 slabs for both regimes, including the Section 87A rebate with marginal relief and 4% health and education cess."
      faqs={FAQS}
      related={[
        { href: '/tools/salary-breakup-calculator', label: 'Salary breakup' },
        { href: '/tools/hra-exemption-calculator', label: 'HRA exemption' },
        { href: '/tools/professional-tax-by-state', label: 'Professional tax by state' },
      ]}
      explanation={
        <>
          <h2>What comes out, in order</h2>
          <p>
            Four things stand between your gross salary and your bank account. Provident fund at
            12% of Basic, capped at a ₹15,000 wage ceiling. Employee State Insurance, but only if
            your gross is ₹21,000 or below. Professional tax, which your state may or may not levy.
            And income tax, deducted monthly as TDS.
          </p>

          <h2>The regime choice is worth real money</h2>
          <p>
            The new regime is simpler and usually wins for people with few deductions. The old
            regime wins when you have a full 80C, meaningful health insurance, a home loan, and
            rent you can claim HRA against. The crossover is not a rule of thumb — it depends on
            your numbers, which is why this page computes both rather than picking one for you.
          </p>
          <p>
            One detail worth knowing because it is frequently got wrong: the Section 87A rebate is
            assessed on income <strong>after</strong> the standard deduction, not on gross. Someone
            on a ₹12.5 lakh gross has ₹11.75 lakh of taxable income and therefore pays nothing
            under the new regime — a calculator that compares gross against the ₹12 lakh threshold
            will tell them they owe roughly ₹70,000.
          </p>

          <h2>Marginal relief, just above the line</h2>
          <p>
            Immediately above ₹12 lakh of taxable income, tax cannot exceed the amount by which you
            crossed the threshold. Without that relief, earning one rupee more than ₹12 lakh would
            cost tens of thousands in tax. This calculator applies it.
          </p>
        </>
      }
    />
  );
}
