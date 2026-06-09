import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  ChevronRight,
  Minus,
  Plus,
  Timer,
  FolderKanban,
  Users,
  CalendarClock,
  CalendarOff,
  Clock,
  Activity,
  Coffee,
  Bell,
  MessageSquare,
  TrendingUp,
  Plug,
  Headphones,
  Building2,
  Wallet,
  Megaphone,
  Smartphone,
  Camera,
  UserCheck,
  BarChart3,
  MapPin,
  Zap,
  Star,
} from 'lucide-react';
import {
  buildCheckoutPath,
  calculateTotal,
  getYearlySavingsPercent,
  getPerSeatPrice,
  pricingPlans,
  pricingUi,
  PricingBillingCycle,
  PlanType,
  PlanModule,
  PRICE_CURRENCY,
  MIN_SEATS,
} from '@/constants/pricing';
import { analytics } from '@/lib/analytics';
import SectionHeading from './SectionHeading';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Timer, FolderKanban, Users, CalendarClock, CalendarOff, Clock,
  Activity, Coffee, Bell, MessageSquare, TrendingUp, Plug, Headphones,
  Building2, Wallet, Megaphone, Smartphone, Camera, UserCheck, BarChart3, MapPin,
};

function ModuleCard({ module }: { module: PlanModule }) {
  const Icon = iconMap[module.icon] || Zap;
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">{module.name}</p>
      </div>
      <ul className="space-y-1">
        {module.features.map((f) => (
          <li key={f} className="flex items-center gap-1.5 text-[12px] text-slate-500">
            <Check className="h-3 w-3 shrink-0 text-emerald-500" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SeatCounter({ value, onChange, min }: { value: number; onChange: (v: number) => void; min: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const display = editing ? draft : String(value);

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onFocus={() => { setEditing(true); setDraft(String(value)); }}
        onBlur={() => {
          const v = parseInt(draft, 10);
          onChange(isNaN(v) || v < min ? min : v);
          setEditing(false);
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, '');
          setDraft(raw);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="h-9 w-14 text-center text-sm font-semibold text-slate-900 outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function PricingSection({ standalone = false }: { standalone?: boolean }) {
  const [planType, setPlanType] = useState<PlanType>('tracking');
  const [billingCycle, setBillingCycle] = useState<PricingBillingCycle>('monthly');
  const [seats, setSeats] = useState(MIN_SEATS);
  const isYearly = billingCycle === 'yearly';

  const filteredPlans = pricingPlans.filter((p) => p.type === planType);

  return (
    <section id="pricing" className={`${standalone ? '' : 'bg-white'} px-4 ${standalone ? 'pb-14 pt-10 sm:pb-18 sm:pt-14' : 'py-14 sm:py-20'} sm:px-6 lg:px-8`}>
      <div className="mx-auto max-w-7xl">
        {standalone && (
          <SectionHeading
            eyebrow="Plans & Pricing"
            title="Choose what fits your team"
            description="Per-user pricing for tracking plans. Workspace pricing for payroll plans. Upgrade or downgrade anytime."
          />
        )}

        {!standalone && (
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Pricing</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Choose what fits your team</h2>
            <p className="mt-3 text-base leading-7 text-slate-500">Per-user pricing for tracking plans. Workspace pricing for payroll plans.</p>
          </div>
        )}

        {/* Plan type toggle */}
        <div className="mt-8 flex justify-center">
          <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-100 p-1">
            {(['tracking', 'payroll'] as PlanType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setPlanType(type)}
                className={`relative rounded-lg px-6 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  planType === type
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {type === 'tracking' ? 'Tracking Plans' : 'Payroll Plans'}
              </button>
            ))}
          </div>
        </div>

        {/* Billing cycle + seats */}
        <div className="mt-6 flex flex-col items-center justify-center gap-4 sm:flex-row">
          {planType === 'tracking' && (
            <>
              <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                {(['monthly', 'yearly'] as PricingBillingCycle[]).map((cycle) => (
                  <button
                    key={cycle}
                    type="button"
                    onClick={() => setBillingCycle(cycle)}
                    className={`rounded-md px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                      billingCycle === cycle
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {cycle === 'monthly' ? 'Monthly' : 'Yearly'}
                    {cycle === 'yearly' && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-white/80">Save 10%</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span>Seats:</span>
                <SeatCounter value={seats} onChange={setSeats} min={MIN_SEATS} />
              </div>
            </>
          )}
          {planType === 'payroll' && (
            <p className="text-sm text-slate-500">
              Base price includes <span className="font-semibold text-slate-700">50 users</span>. Extra users charged per seat.
            </p>
          )}
        </div>

        {isYearly && planType === 'tracking' && (
          <p className="mt-3 text-center text-sm font-medium text-emerald-600">
            Annual billing saves you <span className="font-semibold">10% per seat</span>
          </p>
        )}

        {/* Plan cards */}
        <div className="mt-10 grid gap-5 sm:grid-cols-2" key={planType}>
          {filteredPlans.map((plan) => {
            const isHighlighted = plan.highlighted;
            const savingsPercent = getYearlySavingsPercent(plan);

            let totalPrice = 0;
            let perSeat = 0;
            if (plan.pricePerSeat) {
              perSeat = getPerSeatPrice(plan, billingCycle);
              totalPrice = perSeat * seats;
            } else {
              totalPrice = calculateTotal(plan, seats, billingCycle);
            }

            return (
              <div
                key={plan.code}
                className={`relative flex flex-col overflow-hidden rounded-2xl border-2 shadow-sm transition-all duration-300 hover:shadow-lg animate-fade-up ${
                  isHighlighted
                    ? 'border-blue-500 bg-white ring-1 ring-blue-100'
                    : 'border-slate-200 bg-white'
                }`}
              >
                {/* Badge */}
                {plan.badge && (
                  <div className={`px-5 py-2 text-center ${isHighlighted ? 'bg-gradient-to-r from-blue-600 to-indigo-600' : 'bg-slate-100'}`}>
                    <span className={`text-[11px] font-bold uppercase tracking-[0.18em] ${isHighlighted ? 'text-white' : 'text-slate-500'}`}>
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="flex flex-1 flex-col p-6">
                  {/* Header */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-slate-900">{plan.label}</span>
                      {isHighlighted && <Star className="h-4 w-4 fill-blue-500 text-blue-500" />}
                    </div>
                    <p className="text-sm font-medium text-slate-400 mt-0.5">{plan.tagline}</p>
                  </div>

                  {/* Pricing */}
                  <div className="mb-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
                    {plan.pricePerSeat ? (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-slate-900">{PRICE_CURRENCY}{perSeat}</span>
                          <span className="text-sm text-slate-500">/user/mo</span>
                        </div>
                        {isYearly && savingsPercent > 0 && (
                          <p className="mt-1 text-xs font-medium text-emerald-600">Save {savingsPercent}% vs monthly</p>
                        )}
                        <div className="mt-3 border-t border-slate-200 pt-3">
                          <div className="flex items-baseline justify-between">
                            <span className="text-xs text-slate-400">Total for {seats} users</span>
                            <span className="text-sm font-semibold text-slate-700">
                              {PRICE_CURRENCY}{totalPrice.toLocaleString('en-IN')}
                              <span className="text-xs font-normal text-slate-400">/{isYearly ? 'yr' : 'mo'}</span>
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-slate-900">{PRICE_CURRENCY}{(plan.basePrice ?? 0).toLocaleString('en-IN')}</span>
                          <span className="text-sm text-slate-500">/mo</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          Includes {plan.includedSeats} users. +{PRICE_CURRENCY}{plan.extraSeatPrice}/extra user
                        </p>
                        {seats > (plan.includedSeats ?? 50) && (
                          <div className="mt-3 border-t border-slate-200 pt-3">
                            <div className="flex items-baseline justify-between">
                              <span className="text-xs text-slate-400">Total for {seats} users ({seats - (plan.includedSeats ?? 50)} extra)</span>
                              <span className="text-sm font-semibold text-slate-700">
                                {PRICE_CURRENCY}{totalPrice.toLocaleString('en-IN')}/mo
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {plan.trialAvailable && (
                      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                        <p className="text-xs font-semibold text-emerald-700">{pricingUi.trialBadge}</p>
                        <p className="text-[11px] text-emerald-600">{pricingUi.noCardCopy}</p>
                      </div>
                    )}
                  </div>

                  {/* Modules */}
                  <div className="flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-3">What's included</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {plan.modules.map((mod) => (
                        <ModuleCard key={mod.name} module={mod} />
                      ))}
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="mt-6">
                    <Link
                      to={buildCheckoutPath(plan.code, billingCycle)}
                      onClick={() => { analytics.trackEvent('pricing_cta_clicked', { plan_code: plan.code, action: 'buy-now' }); }}
                      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold shadow-sm transition-all duration-200 ${
                        isHighlighted
                          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 hover:shadow-md'
                          : 'border-2 border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {plan.ctaLabel}
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
