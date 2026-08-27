import { Link } from 'react-router-dom';
import { TRIAL_SEATS } from '@/constants/pricing';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { analytics } from '@/lib/analytics';
import MagneticButton from './MagneticButton';
import GradientOrb from './GradientOrb';

/**
 * Trial length, scoped to this component.
 *
 * `TRIAL_SEATS` above is a long-standing export and is imported normally.
 * There is deliberately no `TRIAL_DAYS` alongside it: adding one means editing
 * a module that /checkout and /payment also import, which is a wider blast
 * radius than a marketing line earns. `constants/pricing.ts` carries the figure
 * inside a plan's `trialBadge` string ("14-day free trial") — grep that if the
 * trial length ever changes. PricingBanner.tsx makes the same call for the same
 * reason.
 */
const TRIAL_DAYS = 14;

export default function CTA() {
  return (
    <section className="relative overflow-hidden cta-band px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
      {/* Animated gradient orbs */}
      <GradientOrb color="rgba(255, 255, 255, 0.08)" size={500} className="-top-40 -left-40" speed={0.06} blur={80} />
      <GradientOrb color="rgba(93, 150, 157, 0.15)" size={400} className="-bottom-20 -right-20" speed={0.08} blur={70} />
      <GradientOrb color="rgba(227, 168, 66, 0.06)" size={300} className="top-1/3 left-1/4" speed={0.1} blur={60} />

      <div className="relative mx-auto max-w-4xl text-center">
        {/* Eyebrow */}
        <motion.span
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80 backdrop-blur-sm"
        >
          Get started today
        </motion.span>

        {/* Heading — word-by-word reveal */}
        <motion.h2
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.3 }}
          className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl"
        >
          {'Ready to transform your workforce?'.split(' ').map((word, i) => (
            <motion.span
              key={i}
              className="inline-block"
              initial={{ opacity: 0, y: 20, filter: 'blur(4px)' }}
              whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              style={{ marginRight: '0.3em' }}
            >
              {word}
            </motion.span>
          ))}
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-5 text-base leading-7 text-white/70 sm:text-lg"
        >
          {/* Was "Join 10,000+ users". There are none to join yet, and the
              sentence works without the number — see Hero.tsx's stats note. */}
          Track the work, run the payroll, and file the returns — in one system, on one record.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <MagneticButton>
            <Link
              to="/start-trial"
              onClick={() => analytics.trackEvent('landing_cta_clicked', { location: 'cta-bottom', action: 'start-trial' })}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3.5 text-sm font-bold text-blue-700 shadow-lg transition-all duration-200 hover:bg-slate-50 hover:shadow-xl sm:w-auto"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4" />
            </Link>
          </MagneticButton>
          <MagneticButton>
            <Link
              to="/contact-sales"
              onClick={() => analytics.trackEvent('landing_cta_clicked', { location: 'cta-bottom', action: 'book-demo' })}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/30 bg-white/10 px-6 py-3.5 text-sm font-bold text-white backdrop-blur-sm transition-all duration-200 hover:border-white/50 hover:bg-white/20 sm:w-auto"
            >
              Book Demo
            </Link>
          </MagneticButton>
        </motion.div>

        {/*
          §14 — the support promise.

          Indian SME buyers convert on reachable humans, which is why the
          research put a phone number here. THERE IS NO PHONE NUMBER IN THIS
          CODEBASE, so there is none on the page: a number that rings nowhere
          breaks the promise at the exact moment of highest intent, which is
          worse than not making it. Same rule as the founder byline in
          HonestProof.tsx — a real slot, never a plausible-looking placeholder.

          ================================================================
          TODO(founder): add the real support number and WhatsApp link, then
          render the commented block below. Until then the promise made is
          only the one that can be kept: a reply from a person, not a queue.
          ================================================================
        */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="mt-10"
        >
          <p className="text-sm text-white/70">
            A person answers, not a ticket queue — and if we are a bad fit we will tell you on the
            first call rather than book a second one.
          </p>
          <p className="mt-3 text-xs text-white/50">
            {/* Corrected: five seats is the TRIAL allowance, not a free tier.
                The JSON-LD carried the same error and was fixed with it. */}
            No credit card required · {TRIAL_DAYS}-day trial, up to {TRIAL_SEATS} users · Cancel anytime
          </p>
        </motion.div>
      </div>
    </section>
  );
}
