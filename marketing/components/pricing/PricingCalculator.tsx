'use client';

import { useMemo, useState } from 'react';
import {
  PLANS,
  SEAT_SLIDER,
  GST_PERCENT,
  MIN_SEATS,
  TRIAL_DAYS,
  formatINR,
  monthlyTotal,
  effectivePerEmployee,
  isPayingForEmptySeats,
  type BillingCycle,
  type Plan,
} from '@/lib/pricing';
import { CTA } from '@/lib/site';
import { Button, Card, cn } from '@/components/ui/primitives';

/**
 * The pricing calculator.
 *
 * greytHR's seat calculator is the best pricing UX in this category and this
 * matches it, with one deliberate difference: it shows the EFFECTIVE per-employee
 * cost, not just the total.
 *
 * That matters because CareVance's payroll plans are workspace-priced with 50
 * seats included. Below 50 people you are paying for seats you do not have —
 * twenty employees on Basic Payroll is ₹200 per person, not the ₹79 the
 * extra-seat line implies. Every vendor with this model hides that; showing it
 * costs one line of arithmetic and is the difference between a pricing page and
 * a pricing trap.
 *
 * The slider is a native <input type="range">, so it is keyboard-operable and
 * announced correctly with no work. It steps through a non-linear stop list
 * because most buyers live under 100 and that range deserves the travel.
 */

export function PricingCalculator() {
  const [stopIndex, setStopIndex] = useState(() =>
    Math.max(0, SEAT_SLIDER.stops.indexOf(25))
  );
  const [cycle, setCycle] = useState<BillingCycle>('yearly');

  const seats = SEAT_SLIDER.stops[stopIndex];

  const rows = useMemo(
    () =>
      PLANS.map((plan) => ({
        plan,
        total: monthlyTotal(plan, seats, cycle),
        perEmployee: effectivePerEmployee(plan, seats, cycle),
        overpaying: isPayingForEmptySeats(plan, seats),
      })),
    [seats, cycle]
  );

  return (
    <div>
      {/* ── Controls ────────────────────────────────────────────────── */}
      <Card className="p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-10">
          <div className="flex-1">
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor="seat-count" className="text-caption uppercase text-n-600">
                How many employees?
              </label>
              <output
                htmlFor="seat-count"
                className="font-display text-2xl font-bold text-n-900 tnum"
              >
                {seats}
              </output>
            </div>

            <input
              id="seat-count"
              type="range"
              min={0}
              max={SEAT_SLIDER.stops.length - 1}
              step={1}
              value={stopIndex}
              onChange={(e) => setStopIndex(Number(e.target.value))}
              aria-valuetext={`${seats} employees`}
              className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-n-200 accent-brand-600 outline-offset-4"
            />

            <div className="mt-2 flex justify-between text-[11px] text-n-500 tnum">
              <span>{SEAT_SLIDER.min}</span>
              <span>100</span>
              <span>{SEAT_SLIDER.max.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <fieldset className="shrink-0">
            <legend className="mb-2 text-caption uppercase text-n-600">Billing</legend>
            <div className="inline-flex rounded-lg border border-n-200 bg-sunken p-1">
              {(['monthly', 'yearly'] as BillingCycle[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCycle(c)}
                  aria-pressed={cycle === c}
                  className={cn(
                    'rounded-md px-4 py-2 text-[13.5px] font-semibold transition-colors',
                    cycle === c ? 'bg-card text-n-900 shadow-card' : 'text-n-600 hover:text-n-800'
                  )}
                >
                  {c === 'monthly' ? 'Monthly' : 'Annual'}
                  {c === 'yearly' && (
                    <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      −10%
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="mt-2 max-w-[16rem] text-[11.5px] leading-4 text-n-600">
              The 10% annual discount applies to per-user tracking plans. Workspace plans are
              billed at the same monthly rate either way.
            </p>
          </fieldset>
        </div>
      </Card>

      {/* ── Plans ───────────────────────────────────────────────────── */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {rows.map(({ plan, total, perEmployee, overpaying }) => (
          <PlanCard
            key={plan.code}
            plan={plan}
            seats={seats}
            total={total}
            perEmployee={perEmployee}
            overpaying={overpaying}
          />
        ))}
      </div>

      <p className="mt-6 text-[13px] leading-6 text-n-600">
        All figures exclude {GST_PERCENT}% GST. Per-user plans have a {MIN_SEATS}-seat minimum.{' '}
        {TRIAL_DAYS}-day free trial on Basic Tracking and Basic Payroll, no credit card required.
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  seats,
  total,
  perEmployee,
  overpaying,
}: {
  plan: Plan;
  seats: number;
  total: number;
  perEmployee: number;
  overpaying: boolean;
}) {
  const perSeat = plan.monthlyPerSeat !== null;

  return (
    <Card
      className={cn(
        'flex flex-col p-6',
        plan.highlighted && 'border-brand-300 ring-1 ring-brand-300'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-bold text-n-900">{plan.label}</h3>
          <p className="text-[12px] font-medium text-n-600">{plan.tagline}</p>
        </div>
        {plan.badge && (
          <span className="shrink-0 rounded-md bg-brand-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-brand-800 uppercase">
            {plan.badge}
          </span>
        )}
      </div>

      <p className="mt-4 text-[13.5px] leading-6 text-n-600">{plan.blurb}</p>

      <div className="mt-5 border-t border-n-200 pt-5">
        {plan.contactOnly ? (
          <p className="font-display text-2xl font-bold text-n-900">Custom</p>
        ) : (
          <>
            <p className="font-display text-3xl font-bold text-n-900 tnum">
              {formatINR(total)}
              <span className="ml-1 text-sm font-medium text-n-600">/month</span>
            </p>

            {/*
              The honest line. On a workspace plan under 50 seats this number is
              much higher than the sticker, and saying so here is the whole
              reason this calculator is worth building.
            */}
            <p className="mt-1.5 text-[13px] text-n-600 tnum">
              {formatINR(Math.round(perEmployee))} per employee, per month
            </p>

            <p className="mt-1 text-[11.5px] text-n-600">
              {perSeat
                ? `${formatINR(
                    (plan.monthlyPerSeat ?? 0) === 0 ? 0 : total / seats
                  )} × ${seats} seats`
                : `${formatINR(plan.basePrice ?? 0)} base · ${plan.includedSeats} seats included${
                    seats > (plan.includedSeats ?? 0)
                      ? ` · ${seats - (plan.includedSeats ?? 0)} × ${formatINR(plan.extraSeatPrice ?? 0)}`
                      : ''
                  }`}
            </p>

            {overpaying && (
              <p className="mt-3 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-[12px] leading-5 text-n-700">
                At {seats} employees you are paying for {(plan.includedSeats ?? 0) - seats} seats
                you do not have. This plan gets cheaper per person up to {plan.includedSeats}.
              </p>
            )}
          </>
        )}
      </div>

      <div className="mt-auto pt-6">
        <Button
          href={plan.contactOnly ? '/contact?intent=enterprise' : CTA.trial.href}
          tone={plan.highlighted ? 'primary' : 'secondary'}
          className="w-full"
        >
          {plan.ctaLabel}
        </Button>
        {plan.trialAvailable && (
          <p className="mt-2 text-center text-[11.5px] text-n-600">
            {TRIAL_DAYS}-day trial · no card
          </p>
        )}
      </div>
    </Card>
  );
}
