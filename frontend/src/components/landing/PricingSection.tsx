import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Minus, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  basicFeatures,
  advancedOnlyFeatures,
  buildCheckoutPath,
  calculateTotal,
  getAnnualSavingsPercent,
  getPricePerUserPerMonth,
  pricingPlans,
  pricingUi,
  PricingBillingCycle,
  PRICE_CURRENCY,
  MIN_SEATS,
} from '@/constants/pricing';
import { analytics } from '@/lib/analytics';
import SectionHeading from './SectionHeading';
import { fadeSlideUp, staggerContainer, viewportOptions, getItemDelay } from './animations';

function SeatCounter({ value, onChange, min }: { value: number; onChange: (v: number) => void; min: number }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="flex h-10 w-10 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="flex h-10 min-w-[2.5rem] items-center justify-center text-sm font-semibold text-slate-900">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="flex h-10 w-10 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function PricingSection({ standalone = false }: { standalone?: boolean }) {
  const [billingCycle, setBillingCycle] = useState<PricingBillingCycle>('monthly');
  const [seats, setSeats] = useState(MIN_SEATS);
  const isYearly = billingCycle === 'yearly';

  return (
    <section id="pricing" className={`${standalone ? '' : 'bg-white'} px-4 ${standalone ? 'pb-14 pt-10 sm:pb-18 sm:pt-14' : 'py-14 sm:py-20'} sm:px-6 lg:px-8`}>
      <div className="mx-auto max-w-7xl">
        {standalone && (
          <SectionHeading
            eyebrow="Pricing"
            title="Simple, transparent pricing"
            description="Choose the plan that fits your team. All plans include a 14-day free trial."
          />
        )}

        {!standalone && (
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Pricing</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Simple, transparent pricing</h2>
            <p className="mt-3 text-base leading-7 text-slate-500">Choose the plan that fits your team. All plans include a 14-day free trial.</p>
          </div>
        )}

        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            {(['monthly', 'yearly'] as PricingBillingCycle[]).map((cycle) => (
              <button
                key={cycle}
                type="button"
                onClick={() => setBillingCycle(cycle)}
                className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
                  billingCycle === cycle
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {cycle === 'monthly' ? 'Monthly' : 'Yearly'}
                {cycle === 'yearly' && (
                  <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-white/80">Save ~17%</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>Seats:</span>
            <SeatCounter value={seats} onChange={setSeats} min={MIN_SEATS} />
          </div>
        </div>

        {isYearly && (
          <p className="mt-3 text-center text-sm font-medium text-emerald-600">
            Annual billing saves you <span className="font-semibold">~17% per seat</span> compared to monthly
          </p>
        )}

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOptions}
          className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {pricingPlans.map((plan, planIndex) => {
            const perSeatPrice = getPricePerUserPerMonth(plan, billingCycle);
            const totalPrice = plan.enterpriseContactOnly ? null : calculateTotal(plan, seats, billingCycle);
            const savingsPercent = getAnnualSavingsPercent(plan);
            const isPopular = plan.badge === 'Most popular';

            return (
              <motion.div
                key={plan.code}
                variants={fadeSlideUp}
                transition={getItemDelay(planIndex)}
              >
                <div
                  className={`relative flex flex-col overflow-hidden rounded-lg border shadow-sm ${
                    isPopular
                      ? 'border-blue-300 bg-white ring-1 ring-blue-300'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  {isPopular && (
                    <div className="bg-blue-600 px-5 py-2 text-center">
                      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white">{plan.badge}</span>
                    </div>
                  )}

                  <div className="flex flex-1 flex-col px-5 pb-5 pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-slate-900">{plan.label}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">{plan.shortDescription}</p>
                      </div>
                      {!isPopular && plan.badge && (
                        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {plan.badge}
                        </span>
                      )}
                    </div>

                    <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                      {plan.enterpriseContactOnly ? (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Custom pricing</p>
                          <p className="mt-1 text-xl font-semibold text-slate-900">Contact Sales</p>
                          <p className="mt-1 text-sm text-slate-500">Custom pricing, rollout support, and billing coordination.</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            {isYearly ? 'Yearly billing' : 'Monthly billing'}
                          </p>
                          <div className="mt-1 flex items-baseline gap-1">
                            <span className="text-2xl font-semibold text-slate-900">{PRICE_CURRENCY}{perSeatPrice}</span>
                            <span className="text-sm text-slate-500">/seat/month</span>
                          </div>
                          {isYearly && savingsPercent > 0 && (
                            <p className="mt-0.5 text-xs font-medium text-emerald-600">Save {savingsPercent}% vs monthly</p>
                          )}
                          <div className="mt-3 border-t border-slate-200 pt-3">
                            <div className="flex items-baseline justify-between">
                              <span className="text-sm text-slate-500">Total for {seats} {seats === 1 ? 'seat' : 'seats'}</span>
                              <span className="text-base font-semibold text-slate-900">
                                {PRICE_CURRENCY}{(totalPrice ?? 0).toLocaleString('en-IN')}
                                <span className="text-xs font-normal text-slate-500">/{isYearly ? 'yr' : 'mo'}</span>
                              </span>
                            </div>
                          </div>
                          {plan.trialAvailable && (
                            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
                              <p className="font-semibold">{pricingUi.trialBadge}</p>
                              <p className="text-emerald-600">{pricingUi.noCardCopy}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">What's included</p>
                      <ul className="mt-3 space-y-2">
                        {plan.code === 'advanced_tracker' ? (
                          <>
                            <li className="rounded-md bg-blue-50 px-3 py-2 text-sm font-medium text-slate-700">
                              All {basicFeatures.length} Basic features, plus:
                            </li>
                            {advancedOnlyFeatures.map((feature) => (
                              <li key={feature} className="flex items-start gap-2 px-3 py-2">
                                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                                  <Check className="h-3 w-3" />
                                </span>
                                <span className="text-sm text-slate-500">{feature}</span>
                              </li>
                            ))}
                          </>
                        ) : (
                          plan.features.map((feature) => (
                            <li key={feature} className="flex items-start gap-2 px-3 py-2">
                              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                                <Check className="h-3 w-3" />
                              </span>
                              <span className="text-sm text-slate-500">{feature}</span>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>

                    <div className="mt-6 flex flex-col gap-2">
                      {plan.enterpriseContactOnly ? (
                        <Link
                          to="/contact-sales"
                          onClick={() => { analytics.trackEvent('pricing_cta_clicked', { plan_code: plan.code, action: 'contact-sales' }); analytics.trackEvent('book_demo_clicked', { location: 'pricing', plan_code: plan.code }); }}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          {plan.ctaLabel}
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      ) : (
                        <Link
                          to={buildCheckoutPath(plan.code, billingCycle)}
                          onClick={() => { analytics.trackEvent('pricing_cta_clicked', { plan_code: plan.code, action: 'buy-now' }); }}
                          className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition ${
                            isPopular
                              ? 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md'
                              : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {plan.ctaLabel}
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
