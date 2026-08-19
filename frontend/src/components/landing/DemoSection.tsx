import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { BarChart3, Clock, Globe2, LifeBuoy, MessageSquare, Scan, Shield, Users } from 'lucide-react';
import AnimatedCounter from './AnimatedCounter';
import SectionNumber from './SectionNumber';
import TextScramble from './TextScramble';

const modules = [
  {
    icon: Clock,
    title: 'Smart Time Tracking',
    description: 'One-click timer with project/task context, idle auto-pause, overtime calculation, and attendance check-in/out in one flow.',
    gradient: 'from-blue-500 to-blue-600',
    lightBg: 'bg-blue-50',
    iconColor: 'text-on-brand',
  },
  {
    icon: Scan,
    title: 'Desktop Monitoring',
    description: 'Windows tracker captures active apps, URLs, idle periods, and screenshots — giving managers clear workday visibility.',
    gradient: 'from-emerald-500 to-emerald-600',
    lightBg: 'bg-emerald-50',
    iconColor: 'text-on-brand',
  },
  {
    icon: BarChart3,
    title: 'Productivity Intelligence',
    description: 'Tracked activity classified as productive, unproductive, or neutral. Dashboards surface trends and exportable reports.',
    gradient: 'from-violet-500 to-violet-600',
    lightBg: 'bg-violet-50',
    iconColor: 'text-on-brand',
  },
  {
    icon: Users,
    title: 'Attendance & Leave',
    description: 'Punch in/out, leave requests, overtime edits, and manager approvals through a unified calendar and workflow.',
    gradient: 'from-amber-500 to-amber-600',
    lightBg: 'bg-amber-50',
    iconColor: 'text-on-brand',
  },
  {
    icon: Globe2,
    title: 'Geo-Fencing',
    description: 'Define location boundaries for attendance — employees check in only when inside the designated geo-fence.',
    gradient: 'from-cyan-500 to-cyan-600',
    lightBg: 'bg-cyan-50',
    iconColor: 'text-on-brand',
  },
  {
    icon: MessageSquare,
    title: 'Team Chat',
    description: 'Built-in messaging tied to workspace and role structure. No need for a separate communication tool.',
    gradient: 'from-rose-500 to-rose-600',
    lightBg: 'bg-rose-50',
    iconColor: 'text-on-brand',
  },
  {
    icon: Shield,
    title: 'Payroll & Compliance',
    description: 'Payroll records, payouts, payslips, and invoices — all within the same system as tracking and attendance.',
    gradient: 'from-indigo-500 to-indigo-600',
    lightBg: 'bg-indigo-50',
    iconColor: 'text-on-brand',
  },
  {
    icon: LifeBuoy,
    title: 'Role-Based Access',
    description: 'Admin, manager, and employee roles with org-scoped data access and bearer-token API security.',
    gradient: 'from-teal-500 to-teal-600',
    lightBg: 'bg-teal-50',
    iconColor: 'text-on-brand',
  },
];

const stats = [
  { value: 15, suffix: '+', label: 'Modules' },
  { value: 8, suffix: '+', label: 'Integration points' },
  { value: 6, suffix: '+', label: 'Report types' },
  { value: 3, suffix: '', label: 'Supported roles' },
];

export default function DemoSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  const x = useTransform(scrollYProgress, [0, 1], ['0%', '-75%']);

  return (
    <section id="product" className="bg-surface-sunken px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <SectionNumber number={1} label="Product" className="mb-6" />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            Product
          </span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
          >
            <TextScramble text="All-in-one workforce management" speed={25} delay={200} />
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl text-base leading-7 text-slate-500"
          >
            From time tracking and monitoring to attendance, payroll, and compliance — everything in a single platform.
          </motion.p>
        </div>

        {/* Stats bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-8 grid divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:grid-cols-4 sm:divide-x sm:divide-y-0"
        >
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center bg-white px-4 py-6 text-center">
              <p className="text-2xl font-bold text-slate-900">
                <AnimatedCounter target={stat.value} suffix={stat.suffix} />
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">{stat.label}</p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Horizontal scroll carousel */}
      <div ref={containerRef} className="relative mt-12" style={{ height: '350vh' }}>
        <div className="sticky top-0 h-screen overflow-hidden">
          {/* Progress indicator */}
          <motion.div
            className="absolute left-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-teal-500 to-indigo-500"
            style={{ width: useTransform(scrollYProgress, [0, 1], ['0%', '100%']) }}
          />
          <motion.div
            style={{ x, display: 'flex', gap: '1.5rem', height: '100%', alignItems: 'center', paddingLeft: 'max(1.5rem, calc((100vw - 80rem) / 2 + 1.5rem))' }}
          >
            {modules.map((mod, i) => (
              <motion.div
                key={mod.title}
                initial={{ opacity: 0, y: 40, scale: 0.95 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.6, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -8, transition: { type: 'spring', stiffness: 350, damping: 20 } }}
                className="flex-shrink-0 w-[360px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-lg sm:w-[420px]"
              >
                {/* Gradient header */}
                <div className={`relative bg-gradient-to-br ${mod.gradient} px-6 py-5`}>
                  <div className="flex items-center gap-4">
                    <div className={`flex h-14 w-14 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm ${mod.iconColor}`}>
                      <mod.icon className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-on-brand">{mod.title}</h3>
                  </div>
                </div>
                {/* Content */}
                <div className="px-6 py-5">
                  <p className="text-sm leading-6 text-slate-600">{mod.description}</p>
                  <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700">
                    Learn more
                    <span className="transition-transform group-hover:translate-x-1">→</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
