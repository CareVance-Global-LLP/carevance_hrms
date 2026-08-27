import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './Reveal';
import { PRICE_CURRENCY, MIN_SEATS } from '@/constants/pricing';

/**
 * Trial length, stated here rather than imported.
 *
 * `constants/pricing.ts` has no TRIAL_DAYS export — it carries the figure only
 * inside a plan's `trialBadge` string ("14-day free trial"). Adding an export
 * would mean editing a module that /checkout and /payment also import, which is
 * a wider blast radius than a marketing banner earns. The literal is scoped
 * here instead and matches that badge; if the trial length changes, the badge
 * is the thing to grep for.
 */
const TRIAL_DAYS = 14;

/**
 * §12 — pricing, as a banner rather than the full table.
 *
 * The table lives at /pricing and is genuinely good: a seat slider, both
 * billing cycles, and the effective per-employee cost at your headcount rather
 * than a sticker price that hides it. Repeating it here would double the
 * page's longest section and force a second maintenance point for the same
 * numbers.
 *
 * What the homepage owes a buyer at this scroll depth is the FACT that pricing
 * is published at all — most of this market makes you ask — plus the entry
 * price and the one honest caveat about it. The caveat is deliberate: on a
 * workspace plan below its included seats the effective per-employee cost is
 * much higher than the headline, and a buyer discovering that at checkout is a
 * buyer who stops trusting the rest of the page.
 *
 * Every figure is read from constants/pricing.ts, the same table /pricing
 * renders. Nothing here is typed by hand.
 */
export default function PricingBanner() {
  return (
    <section className="bg-slate-50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <Reveal>
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                  Pricing
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                  Published, because most of this market hides it.
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  Per-user pricing for tracking, workspace pricing for payroll, and a{' '}
                  {TRIAL_DAYS}-day trial with no card. The calculator shows your real
                  per-employee cost at your headcount — including where a workspace plan costs
                  more per person than the sticker suggests, which is the number most vendors
                  leave you to discover.
                </p>
                <p className="mt-3 text-[13px] text-slate-400">
                  From {PRICE_CURRENCY}399 per user per month · minimum {MIN_SEATS} seats ·
                  prices exclude GST
                </p>
              </div>

              <Link
                to="/pricing"
                className="inline-flex h-12 shrink-0 items-center gap-2 rounded-lg bg-blue-700 px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                See full pricing &amp; calculator
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
