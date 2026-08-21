import type { Metadata } from 'next';
import { ToolPage } from '@/components/tools/ToolPage';
import { HraCalculator } from '@/components/tools/HraCalculator';

export const metadata: Metadata = {
  title: 'HRA exemption calculator',
  description:
    'House Rent Allowance exemption under Section 10(13A) — the least-of-three rule, with the limb that binds your exemption named so you know which lever actually moves it.',
  alternates: { canonical: '/tools/hra-exemption-calculator' },
};

const FAQS = [
  {
    q: 'Which cities count as metro for HRA?',
    a: 'Only Delhi, Mumbai, Kolkata and Chennai. Bengaluru, Hyderabad, Pune and Gurugram are all non-metro for this purpose, whatever their rents look like. Metro status raises the second limb from 40% to 50% of Basic.',
  },
  {
    q: 'Can I claim HRA under the new tax regime?',
    a: 'No. The new regime allows only the ₹75,000 standard deduction — no HRA exemption, no 80C, no 80D, no home-loan interest. If your HRA exemption is large, that alone can be the reason the old regime works out cheaper for you.',
  },
  {
    q: 'Can I claim HRA while paying rent to a family member?',
    a: 'Yes, if the arrangement is genuine — they must actually own the property, you must actually pay the rent, and they must declare it as income. Keep a rent agreement and bank transfers. Cash paid to a parent who does not declare it is the arrangement that gets disallowed.',
  },
  {
    q: 'Do I need my landlord’s PAN?',
    a: 'If your annual rent exceeds ₹1,00,000, yes — you must report the landlord’s PAN to your employer. Without it the exemption is typically disallowed at the payroll stage, even if you genuinely paid the rent.',
  },
  {
    q: 'Why is my exemption so much smaller than my HRA?',
    a: 'Because the smallest of three limbs wins, and it is usually the rent limb — rent paid minus 10% of Basic. If your rent is low relative to your Basic, that limb collapses. The calculator names which limb is binding, so you can see whether more rent would actually help or whether your Basic has capped you.',
  },
] as const;

export default function Page() {
  return (
    <ToolPage
      title="HRA exemption calculator"
      href="/tools/hra-exemption-calculator"
      eyebrow="Free calculator"
      lede="How much of your House Rent Allowance escapes tax — and, more usefully, which of the three limbs is holding it down. Knowing that tells you whether paying more rent would change anything."
      calculator={<HraCalculator />}
      provenance="PayrollCalculatorService::calculateHraExemption — Section 10(13A), least of the three limbs, with the metro percentage at 50% and non-metro at 40%."
      faqs={FAQS}
      related={[
        { href: '/tools/take-home-salary-calculator', label: 'Take-home salary' },
        { href: '/tools/salary-breakup-calculator', label: 'Salary breakup' },
      ]}
      explanation={
        <>
          <h2>The least of three</h2>
          <p>Your exemption is the smallest of these three figures:</p>
          <ol className="ml-5 list-decimal space-y-1">
            <li>The HRA you actually received</li>
            <li>50% of Basic if you live in a metro, 40% if you do not</li>
            <li>Rent you paid, minus 10% of Basic</li>
          </ol>
          <p>
            The third limb is the one that usually binds, and it has a sharp consequence: if your
            rent is less than 10% of your Basic, that limb is zero and your entire HRA is taxable
            no matter how large it is.
          </p>

          <h2>Why naming the binding limb matters</h2>
          <p>
            Telling you the exemption is ₹1,20,000 is not actionable. Telling you that the{' '}
            <em>rent limb</em> is what caps it means more rent would raise your exemption — while
            if the 40%-of-Basic limb is binding, more rent changes nothing at all and you would be
            spending money for no tax benefit.
          </p>
          <p>
            This is the same discipline the product applies to a payslip: show the number, and show
            the rule that produced it. A figure without its reason cannot be acted on.
          </p>

          <h2>Regime interaction</h2>
          <p>
            HRA exemption exists only under the old regime. When you compare regimes, a large HRA
            exemption is often the single biggest factor pulling towards the old one — which is why
            the take-home calculator feeds this figure straight into its comparison.
          </p>
        </>
      }
    />
  );
}
