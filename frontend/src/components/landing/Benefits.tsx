import { motion } from 'framer-motion';
import { Briefcase, Eye, Rocket, UsersRound } from 'lucide-react';
import SectionHeading from './SectionHeading';

const benefits = [
  {
    icon: Rocket,
    title: 'See who is working right now',
    description: 'User management, monitoring, and reports all expose live working status and current activity context.',
  },
  {
    icon: Eye,
    title: 'Review idle time and tool usage',
    description: 'Managers can inspect idle events, app or URL breakdowns, and recent screenshots for monitored employees.',
  },
  {
    icon: UsersRound,
    title: 'Run attendance and leave operations from one place',
    description: 'Attendance summaries, monthly calendars, leave approvals, and overtime or time-edit requests are part of the same app.',
  },
  {
    icon: Briefcase,
    title: 'Connect HR and finance workflows',
    description: 'The product also includes payroll records, payslips, payout tracking, invoices, projects, tasks, chat, and notifications.',
  },
];

export default function Benefits() {
  return (
    <section className="px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <SectionHeading
            eyebrow="Benefits"
            title="What the current product helps teams manage"
            description="The system is positioned more as an operational HRMS and monitoring workspace than a pure marketing-site SaaS shell."
            align="left"
          />
          <div className="grid gap-4 sm:gap-5 sm:grid-cols-2">
            {benefits.map((benefit, index) => (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.5, delay: index * 0.06 }}
                className="rounded-[28px] border border-slate-200/70 bg-white/85 p-5 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.75)] backdrop-blur sm:p-6"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <benefit.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-slate-950">{benefit.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{benefit.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
