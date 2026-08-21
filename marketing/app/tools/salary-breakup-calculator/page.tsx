import type { Metadata } from 'next';
import { ToolPage } from '@/components/tools/ToolPage';
import { SalaryBreakupCalculator } from '@/components/tools/SalaryBreakupCalculator';

export const metadata: Metadata = {
  title: 'Salary breakup calculator',
  description:
    'Break an annual CTC into Basic, HRA, conveyance and special allowance, with PF, ESI, professional tax and TDS — using the same structure logic as the CareVance payroll engine.',
  alternates: { canonical: '/tools/salary-breakup-calculator' },
};

const FAQS = [
  {
    q: 'Why does my special allowance fall so fast when I raise Basic?',
    a: 'Because more than one thing moves with Basic. HRA is a percentage of it, employer PF is computed on it, and the gratuity provision is 4.81% of it — and all three sit inside the CTC envelope. Raising Basic by ₹1 therefore consumes roughly ₹1.67 of CTC at the usual rates, and the special allowance is what absorbs the difference.',
  },
  {
    q: 'What is a residual component?',
    a: 'The component that absorbs whatever is left after every other component is computed, so the total returns to CTC exactly. It is usually called Special Allowance. It has to be a taxable component — falling back onto HRA or conveyance would change your tax position just to satisfy an arithmetic identity.',
  },
  {
    q: 'Why does the calculator refuse some Basic percentages?',
    a: 'Because at a high enough Basic the structure genuinely cannot fit inside the CTC, and the residual would go negative. Rather than showing a negative special allowance, the calculator refuses and names the highest Basic that would work. That is exactly what the payroll engine does at entry, instead of accepting the value and failing at finalisation weeks later.',
  },
  {
    q: 'Is employer PF part of my CTC or on top of it?',
    a: 'Part of it, in the standard Indian structure. Employer PF and the gratuity provision are employer costs that sit inside the CTC envelope but never appear on the payslip, which is why your gross is always lower than your CTC divided by twelve.',
  },
  {
    q: 'Why is PF only ₹1,800 when my Basic is much higher?',
    a: 'The statutory PF wage ceiling is ₹15,000, so 12% of that is ₹1,800. An employer can choose to contribute on the full Basic instead, but it is not required, and most do not.',
  },
] as const;

export default function Page() {
  return (
    <ToolPage
      title="Salary breakup calculator"
      href="/tools/salary-breakup-calculator"
      eyebrow="Free calculator"
      lede="Turn an annual CTC into the components that actually appear on a payslip — and see the employer costs hiding inside it. The last line balances back to your CTC exactly, because that is how the engine works."
      calculator={<SalaryBreakupCalculator />}
      provenance="Structure percentages from PayrollCalculatorService::resolveStructureConfig (Basic 40% of CTC, HRA 50% of Basic in metros and 40% elsewhere, conveyance ₹1,600). PF at the ₹15,000 ceiling, gratuity provision at 4.81%, professional tax from PTStateService, TDS on FY 2025-26 slabs."
      faqs={FAQS}
      related={[
        { href: '/tools/take-home-salary-calculator', label: 'Take-home salary' },
        { href: '/tools/hra-exemption-calculator', label: 'HRA exemption' },
        { href: '/tools/professional-tax-by-state', label: 'Professional tax by state' },
      ]}
      explanation={
        <>
          <h2>What CTC actually contains</h2>
          <p>
            Cost to company is the employer’s total annual cost, not your salary. It contains three
            kinds of thing: money that reaches your bank account, money deducted from you and paid
            to the government, and money the employer spends on you that you never see as cash.
          </p>
          <p>
            The third kind is the one that surprises people. Employer provident fund and the
            gratuity provision are both real costs, both inside CTC, and neither appears on a
            payslip. That is why a ₹14,40,000 CTC produces a gross of about ₹1,15,891 a month
            rather than ₹1,20,000.
          </p>

          <h2>The residual, and why it matters</h2>
          <p>
            Every component except one is computed from a rule — Basic is a percentage of CTC, HRA
            is a percentage of Basic, and so on. One component then absorbs whatever is left so the
            total comes back to CTC. That component is the <strong>residual</strong>, and it is
            usually called Special Allowance.
          </p>
          <p>
            Its role explains a behaviour that confuses almost everyone the first time they meet
            it: changing one component moves another by more than you expected. Raise Basic by
            ₹12,000 and Special Allowance does not fall by ₹12,000 — it falls by about ₹20,000,
            because HRA, employer PF and the gratuity provision all rose alongside Basic and all
            come out of the same envelope.
          </p>

          <h2>When the structure cannot fit</h2>
          <p>
            Push Basic high enough and there is nothing left for the residual to hold. Most
            calculators show a negative special allowance and let you work out for yourself that
            something is wrong. This one refuses, and tells you the highest Basic that would
            actually balance — which is the behaviour the payroll engine applies at the moment an
            admin types the value, rather than at finalisation weeks later.
          </p>
        </>
      }
    />
  );
}
