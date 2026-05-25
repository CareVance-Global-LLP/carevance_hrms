import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import CTA from '@/components/landing/CTA';
import PricingSection from '@/components/landing/PricingSection';
import FeatureComparison from '@/components/landing/FeatureComparison';
import FAQSection from '@/components/landing/FAQSection';

const trustMetrics = [
  { label: 'Active users', value: '10,000+' },
  { label: 'Workspaces onboarded', value: '500+' },
  { label: 'Avg productivity lift', value: '32%' },
  { label: 'Avg rating', value: '4.8/5' },
];

export default function PricingPage() {
  return (
    <div className="text-slate-950">
      <Navbar />

      <section className="bg-white px-4 pb-8 pt-20 sm:px-6 sm:pb-10 sm:pt-28 lg:px-8">
        <div className="mx-auto max-w-5xl text-center">
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            Plans & pricing
          </span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Find the right plan for your team
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-slate-500">
            Start with a 14-day free trial — no credit card required. Upgrade, downgrade, or cancel at any time.
          </p>
        </div>

        {/* Trust metrics */}
        <div className="mx-auto mt-8 grid max-w-3xl gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 shadow-sm sm:grid-cols-4">
          {trustMetrics.map((metric) => (
            <div key={metric.label} className="flex flex-col items-center bg-white px-4 py-5 text-center">
              <p className="text-xl font-bold text-slate-900">{metric.value}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">{metric.label}</p>
            </div>
          ))}
        </div>
      </section>

      <PricingSection standalone />

      <div className="bg-white">
        <FeatureComparison />
      </div>

      <div className="bg-[#f3f6fb]">
        <FAQSection />
      </div>

      <CTA />
      <Footer />
    </div>
  );
}
