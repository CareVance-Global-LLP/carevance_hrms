import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import {
  buildSignupQuery,
  getPlanPrice,
  pricingPlans,
  pricingUi,
  PricingBillingCycle,
} from '@/constants/pricing';
import { analytics } from '@/lib/analytics';

export default function PricingSection({ standalone = false }: { standalone?: boolean }) {
  const [billingCycle, setBillingCycle] = useState<PricingBillingCycle>('monthly');

  return (
    <section id="pricing" className={`px-4 ${standalone ? 'pb-12 pt-20 sm:pb-18 sm:pt-24' : 'py-18 sm:py-24'} sm:px-6 lg:px-8`}>
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-sky-700">Pricing</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-[3.4rem] sm:leading-[0.95]">
            Choose the CareVance rollout that matches your team
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-600 sm:text-[1.05rem]">
            Clear plan definitions, editable copy, and a billing foundation built for trial onboarding now and subscription activation later.
          </p>
          <div className="mt-8 inline-flex rounded-full border border-slate-200/90 bg-white/85 p-1 shadow-[0_18px_46px_-28px_rgba(15,23,42,0.22)]">
            {(['monthly', 'yearly'] as PricingBillingCycle[]).map((cycle) => (
              <button
                key={cycle}
                type="button"
                onClick={() => setBillingCycle(cycle)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  billingCycle === cycle
                    ? 'bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] text-white shadow-[0_14px_30px_-18px_rgba(14,165,233,0.55)]'
                    : 'text-slate-500 hover:text-slate-950'
                }`}
              >
                {cycle === 'monthly' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {pricingPlans.map((plan) => {
            const price = getPlanPrice(plan, billingCycle);
            const query = buildSignupQuery(plan.code, plan.trialAvailable ? 'trial' : 'paid', billingCycle);

            return (
              <AdaptiveSurface
                key={plan.code}
                className={`relative overflow-hidden rounded-[30px] border p-6 shadow-[0_36px_90px_-52px_rgba(15,23,42,0.32)] ${
                  plan.badge === 'Most popular'
                    ? 'border-sky-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(239,246,255,0.96))]'
                    : 'border-white/80 bg-white/88'
                }`}
                tone="light"
                backgroundColor="rgba(255,255,255,0.9)"
              >
                <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.22),transparent_72%)]" />
                <div className="relative">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xl font-semibold tracking-[-0.04em] text-slate-950">{plan.label}</p>
                      <p className="mt-2 text-sm leading-7 text-slate-600">{plan.shortDescription}</p>
                    </div>
                    {plan.badge ? (
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-700">
                        {plan.badge}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-8 rounded-[24px] border border-slate-200/80 bg-slate-50/85 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                      {billingCycle === 'monthly' ? 'Monthly billing' : 'Yearly billing'}
                    </p>
                    <div className="mt-3 flex items-end gap-2">
                      <p className="text-4xl font-semibold tracking-[-0.05em] text-slate-950">
                        {plan.enterpriseContactOnly ? 'Contact Sales' : price}
                      </p>
                      {!plan.enterpriseContactOnly ? <span className="pb-1 text-sm text-slate-500">/workspace</span> : null}
                    </div>
                    {plan.trialAvailable ? (
                      <div className="mt-4 rounded-[18px] border border-emerald-200/80 bg-emerald-50/85 px-3.5 py-3 text-sm text-emerald-700">
                        <p className="font-semibold">{pricingUi.trialBadge}</p>
                        <p className="mt-1 text-emerald-600">{pricingUi.noCardCopy}</p>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm leading-7 text-slate-500">Custom pricing, rollout support, and billing coordination through sales.</p>
                    )}
                  </div>

                  <ul className="mt-6 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 rounded-[18px] bg-white/75 px-3 py-2.5">
                        <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-sm leading-7 text-slate-600">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8 flex flex-col gap-3">
                    {plan.enterpriseContactOnly ? (
                      <Link
                        to="/contact-sales"
                        onClick={() => {
                          analytics.trackEvent('pricing_cta_clicked', { plan_code: plan.code, action: 'contact-sales' });
                          analytics.trackEvent('book_demo_clicked', { location: 'pricing', plan_code: plan.code });
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition duration-300 hover:-translate-y-0.5"
                      >
                        {plan.ctaLabel}
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    ) : (
                      <>
                        <Link
                          to={`/signup-owner?${query}`}
                          onClick={() => {
                            analytics.trackEvent('pricing_cta_clicked', { plan_code: plan.code, action: 'start-trial' });
                            analytics.trackEvent('start_trial_clicked', { location: 'pricing', plan_code: plan.code });
                          }}
                          className="inline-flex items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition duration-300 hover:-translate-y-0.5"
                        >
                          {plan.ctaLabel}
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                        <Link
                          to={`/signup-owner?${buildSignupQuery(plan.code, 'paid', billingCycle)}`}
                          onClick={() => {
                            analytics.trackEvent('pricing_cta_clicked', { plan_code: plan.code, action: 'paid-plan' });
                          }}
                          className="inline-flex items-center justify-center rounded-full border border-slate-300/85 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition duration-300 hover:-translate-y-0.5 hover:border-slate-950"
                        >
                          Continue with Paid Plan
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </AdaptiveSurface>
            );
          })}
        </div>
      </div>
    </section>
  );
}
