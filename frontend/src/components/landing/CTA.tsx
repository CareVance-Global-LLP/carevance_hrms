import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { analytics } from '@/lib/analytics';
import MagneticButton from './MagneticButton';
import GradientOrb from './GradientOrb';

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
          Join 10,000+ users who track time, manage attendance, and process payroll — all in one platform.
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

        {/* Trust line */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="mt-8 text-xs text-white/50"
        >
          No credit card required · Free for up to 5 users · Cancel anytime
        </motion.p>
      </div>
    </section>
  );
}
