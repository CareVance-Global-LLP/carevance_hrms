import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { analytics } from '@/lib/analytics';
import { viewportOptions } from './animations';

export default function CTA() {
  return (
    <section className="bg-white px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewportOptions}
        transition={{ duration: 0.5 }}
        className="mx-auto max-w-7xl rounded-lg border border-slate-200 bg-white px-6 py-12 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md sm:px-10 sm:py-16"
      >
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Get started today</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Ready to see what your team is working on?
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              Start a 14-day free trial — no credit card required. Set up in minutes and get instant visibility.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to="/start-trial"
              onClick={() => { analytics.trackEvent('landing_cta_clicked', { location: 'footer-cta', action: 'start-trial' }); analytics.trackEvent('start_trial_clicked', { location: 'footer-cta' }); }}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:bg-blue-700 hover:shadow-md"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/contact-sales"
              onClick={() => { analytics.trackEvent('landing_cta_clicked', { location: 'footer-cta', action: 'contact-sales' }); analytics.trackEvent('book_demo_clicked', { location: 'footer-cta' }); }}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md"
            >
              Contact Sales
            </Link>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
