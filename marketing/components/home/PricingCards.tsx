'use client';

import { useState } from 'react';
import { cn } from '@/components/ui/primitives';
import { BillingToggle, AnimatedPrice } from '@/components/home/BillingToggle';
import type { BillingCycle } from '@/lib/pricing';

/**
 * The three pricing cards, and the cycle they are priced on.
 *
 * WHY THE DATA ARRIVES AS PROPS AND NOT AS AN IMPORT. This is the only client
 * component on the homepage that touches pricing, and `lib/pricing` carries the
 * whole plan table plus `monthlyTotal`, `effectivePerEmployee`,
 * `breakEvenSeats` and the seat slider's stops — none of which this needs. The
 * server resolves the six numbers that actually appear and passes them down.
 * Same rule as ChainHero and ProductTour.
 *
 * `formatRupees` is duplicated from `formatINR` rather than imported for the
 * same reason, and is deliberately identical to it: en-IN grouping, no paise.
 * `verify:claims` asserts every currency string on this site uses en-IN
 * grouping and refuses any dollar-denominated amount outright, so a drift here
 * fails the build instead of shipping a foreign-looking price to the only
 * market this product sells into.
 */

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatRupees = (n: number) => RUPEES.format(n);

export interface PriceCard {
  title: string;
  /** null when the plan is contact-only. */
  monthly: number | null;
  /** null when the plan has no annual price — NOT the same as equal to monthly. */
  yearly: number | null;
  unit: string;
  body: string;
  points: readonly string[];
  highlighted: boolean;
}

export function PricingCards({
  cards,
  savingLabel,
}: {
  cards: readonly PriceCard[];
  savingLabel: string;
}) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  return (
    <>
      <div className="mt-8">
        <BillingToggle cycle={cycle} onChange={setCycle} savingLabel={savingLabel} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {cards.map((card) => {
          const amount =
            cycle === 'yearly' && card.yearly !== null ? card.yearly : card.monthly;

          return (
            <div
              key={card.title}
              className={cn(
                'flex flex-col rounded-xl border bg-card p-6 shadow-card',
                card.highlighted ? 'border-brand-300 ring-1 ring-brand-300' : 'border-n-200'
              )}
            >
              {card.highlighted && (
                <span className="mb-3 self-start rounded-md bg-brand-100 px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-brand-800 uppercase">
                  Most bought
                </span>
              )}
              <h3 className="font-display text-lg font-bold text-n-900">{card.title}</h3>

              <p className="mt-1.5 font-display text-2xl font-bold text-n-900">
                {amount === null ? (
                  'Custom'
                ) : (
                  <>
                    <AnimatedPrice value={amount} format={formatRupees} />
                    <span className="text-[15px] font-semibold text-n-600"> {card.unit}</span>
                  </>
                )}
              </p>

              {/*
                Said out loud, per card. A toggle that visibly changes one card
                and silently leaves two alone is the version a reader concludes
                is broken — or worse, assumes saved them money.
              */}
              {cycle === 'yearly' && amount !== null && (
                <p className="mt-1 text-[11.5px] leading-4 text-n-600">
                  {card.yearly === null
                    ? 'Same either way — this plan has no annual discount.'
                    : 'Billed yearly.'}
                </p>
              )}

              <p className="mt-2 text-[14px] leading-6 text-n-600">{card.body}</p>

              <ul className="mt-4 grid gap-2">
                {card.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-[13.5px] leading-6 text-n-700">
                    <svg
                      viewBox="0 0 16 16"
                      className="mt-1.5 h-3 w-3 shrink-0 text-brand-600"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 8.5 6.2 11.6 13 4.6" />
                    </svg>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}
