import { motion } from 'framer-motion';
import { Clock, Shield, BarChart3, Headphones, Zap, Globe } from 'lucide-react';
import { viewportOptions, cardHoverEnhanced } from './animations';
import SectionNumber from './SectionNumber';

const benefits = [
  {
    icon: Clock,
    title: 'Save 10+ hours weekly',
    description: 'Automate time tracking, attendance, and payroll calculations. Eliminate manual data entry and reduce administrative overhead dramatically.',
    span: 'col-span-1 lg:col-span-2',
    variant: 'from-teal' as const,
  },
  {
    icon: Shield,
    title: 'Enterprise-grade security',
    description: 'SOC 2 compliant, GDPR ready, role-based access control. Your data is encrypted at rest and in transit.',
    span: 'col-span-1',
    variant: 'from-blue' as const,
  },
  {
    icon: BarChart3,
    title: 'Actionable insights',
    description: 'Real-time dashboards with productivity trends, attendance patterns, and cost breakdowns. Export to CSV or JSON.',
    span: 'col-span-1',
    variant: 'from-violet' as const,
  },
  {
    icon: Zap,
    title: 'Lightning-fast setup',
    description: 'Get your entire team onboarded in minutes, not weeks. No training required — the interface is intuitive from day one.',
    span: 'col-span-1',
    variant: 'from-amber' as const,
  },
  {
    icon: Globe,
    title: 'Works everywhere',
    description: 'Desktop tracker for Windows, web dashboard for managers, mobile-responsive for everyone. Hybrid and remote teams love it.',
    span: 'col-span-1 lg:col-span-2',
    variant: 'from-emerald' as const,
  },
  {
    icon: Headphones,
    title: 'Dedicated support',
    description: 'Responsive human support that understands your workflow. Setup assistance, training, and ongoing help included.',
    span: 'col-span-1',
    variant: 'from-rose' as const,
  },
];

const variantColors: Record<string, { bg: string; icon: string }> = {
  'from-teal': { bg: 'bg-gradient-to-br from-teal-50 to-blue-50', icon: 'bg-teal-100 text-teal-700' },
  'from-blue': { bg: 'bg-gradient-to-br from-blue-50 to-indigo-50', icon: 'bg-blue-100 text-blue-700' },
  'from-violet': { bg: 'bg-gradient-to-br from-violet-50 to-purple-50', icon: 'bg-violet-100 text-violet-700' },
  'from-amber': { bg: 'bg-gradient-to-br from-amber-50 to-orange-50', icon: 'bg-amber-100 text-amber-700' },
  'from-emerald': { bg: 'bg-gradient-to-br from-emerald-50 to-teal-50', icon: 'bg-emerald-100 text-emerald-700' },
  'from-rose': { bg: 'bg-gradient-to-br from-rose-50 to-pink-50', icon: 'bg-rose-100 text-rose-700' },
};

const entryVariants = [
  { hidden: { opacity: 0, y: 32 }, visible: { opacity: 1, y: 0 } },
  { hidden: { opacity: 0, x: -32 }, visible: { opacity: 1, x: 0 } },
  { hidden: { opacity: 0, y: -32 }, visible: { opacity: 1, y: 0 } },
  { hidden: { opacity: 0, x: 32 }, visible: { opacity: 1, x: 0 } },
  { hidden: { opacity: 0, y: 32 }, visible: { opacity: 1, y: 0 } },
  { hidden: { opacity: 0, x: -32 }, visible: { opacity: 1, x: 0 } },
];

export default function Benefits() {
  return (
    <section className="bg-white px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionNumber number={4} label="Benefits" className="mb-6" />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            Why Carevance
          </span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
          >
            Built for teams that move fast
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl text-base leading-7 text-slate-500"
          >
            Everything you need to manage your workforce, from hiring to payroll, in one beautiful platform.
          </motion.p>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit, i) => {
            const colors = variantColors[benefit.variant];
            const entry = entryVariants[i % entryVariants.length];
            return (
              <motion.div
                key={benefit.title}
                initial={entry.hidden}
                whileInView={entry.visible}
                viewport={viewportOptions}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -6, transition: { type: 'spring', stiffness: 350, damping: 20 } }}
                className={`rounded-2xl border border-slate-200/80 p-5 shadow-sm transition-shadow duration-300 hover:shadow-lg ${benefit.span} ${colors.bg}`}
              >
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${colors.icon}`}>
                  <benefit.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-3.5 text-[15px] font-bold text-slate-900">{benefit.title}</h3>
                <p className="mt-1.5 text-[13px] leading-5.5 text-slate-600">{benefit.description}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
