import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import CTA from '@/components/landing/CTA';
import PricingSection from '@/components/landing/PricingSection';
import FeatureComparison from '@/components/landing/FeatureComparison';
import FAQSection from '@/components/landing/FAQSection';
import LandingPageChatBubble from '@/components/LandingPageChatBubble';

/**
 * COUNTED FROM THE CODEBASE, NOT INVENTED.
 *
 * This block carried "10,000+ active users", "500+ workspaces onboarded", a
 * "32% avg productivity lift" and a "4.8/5 avg rating". None of them existed —
 * there are no users to count, no workspaces to count, no study behind a
 * productivity figure and no platform issuing a rating.
 *
 * They were removed from the landing hero in the first pass of this work and
 * SURVIVED HERE, because this page keeps its own copy of the same four
 * numbers. That is the lesson worth keeping: a claim deleted in one component
 * is not deleted from the product. `scripts/check-public-pages.mjs` now sweeps
 * every public route for exactly these strings so the next copy cannot hide.
 *
 * The replacements are audited in PRODUCT_TRUTH.md under the ids beside them,
 * and each names the file it was counted from. What a company with no customers
 * honestly has is scope, and scope is checkable.
 */
const trustMetrics = [
  { label: 'States & UTs with PT resolved', value: '37' }, // STA-04
  { label: 'Statutory documents generated', value: '23' }, // FIL-01
  { label: 'Apps in the suite', value: '4' }, // NUM-05
  { label: 'Days of free trial, no card', value: '14' }, // PRC-01
];

const planTypes = [
  {
    title: 'Tracking Plans',
    description: 'Per-user pricing for teams that need time tracking, screenshots, and productivity insights.',
    color: 'blue',
  },
  {
    title: 'Payroll Plans',
    description: 'Workspace pricing with full HRMS, payroll automation, compliance, and employee management.',
    color: 'indigo',
  },
];

export default function PricingPage() {
  return (
    <div className="text-slate-950">
      <Navbar />

      <section className="bg-gradient-to-b from-white via-blue-50/30 to-white px-4 pb-8 pt-20 sm:px-6 sm:pb-10 sm:pt-28 lg:px-8">
        <div className="mx-auto max-w-5xl text-center">
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            Plans & pricing
          </span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-slate-500">
            Start with a 14-day free trial. Upgrade, downgrade, or cancel anytime.
          </p>
        </div>

        {/* Trust metrics */}
        <div className="mx-auto mt-8 grid max-w-3xl gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-sm sm:grid-cols-4">
          {trustMetrics.map((metric) => (
            <div key={metric.label} className="flex flex-col items-center bg-white px-4 py-5 text-center">
              <p className="text-xl font-bold text-slate-900">{metric.value}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">{metric.label}</p>
            </div>
          ))}
        </div>

        {/* Plan type cards */}
        <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-2">
          {planTypes.map((pt) => (
            <div
              key={pt.title}
              className={`rounded-xl border p-5 ${
                pt.color === 'blue'
                  ? 'border-blue-200 bg-blue-50/50'
                  : 'border-indigo-200 bg-indigo-50/50'
              }`}
            >
              <p className={`text-sm font-bold ${pt.color === 'blue' ? 'text-blue-700' : 'text-indigo-700'}`}>
                {pt.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{pt.description}</p>
            </div>
          ))}
        </div>
      </section>

      <PricingSection standalone />

      <div className="bg-white">
        <FeatureComparison />
      </div>

      <div className="bg-surface-sunken">
        <FAQSection />
      </div>

      <CTA />
      <Footer />
      <LandingPageChatBubble />
    </div>
  );
}
