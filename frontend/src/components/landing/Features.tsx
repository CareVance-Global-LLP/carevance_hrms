import { motion } from 'framer-motion';
import {
  Activity,
  AppWindow,
  BarChart3,
  Clock3,
  Receipt,
  Users,
} from 'lucide-react';
import SectionHeading from './SectionHeading';

const features = [
  {
    icon: AppWindow,
    title: 'Employee Activity Monitoring',
    description: 'The desktop tracker records active app or URL context, idle periods, and screenshots against the running timer.',
  },
  {
    icon: BarChart3,
    title: 'Productive vs Unproductive Analysis',
    description: 'Monitoring reports classify tracked tools and websites into productive, unproductive, and neutral buckets.',
  },
  {
    icon: Clock3,
    title: 'Attendance, Leave, and Time Edit Requests',
    description: 'Employees can punch in or out, request leave, and submit overtime or manual time adjustments for approval.',
  },
  {
    icon: Users,
    title: 'User and Report Group Management',
    description: 'Admins and managers can create users, assign roles, review live status, and organize teams into report groups.',
  },
  {
    icon: Activity,
    title: 'Reporting and Monitoring Dashboards',
    description: 'The app includes dashboard summaries, attendance reports, employee insights, team rankings, and CSV export.',
  },
  {
    icon: Receipt,
    title: 'Payroll, Payslips, and Invoices',
    description: 'Managers can generate payroll records, process payouts, issue payslips, and manage invoice records inside the app.',
  },
];

export default function Features() {
  return (
    <section id="features" className="px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Features"
          title="Core features implemented in the repository"
          description="These cards reflect the modules and workflows that are present in the current frontend and backend code."
        />

        <div className="mt-10 grid gap-4 sm:mt-12 sm:gap-5 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.5, delay: index * 0.06 }}
              whileHover={{ y: -8 }}
              className="glass-panel group rounded-[28px] p-5 sm:p-6"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a,#0ea5e9)] text-white shadow-lg shadow-sky-950/15 transition duration-300 group-hover:scale-105">
                <feature.icon className="h-6 w-6" />
              </div>
              <h3 className="mt-6 text-xl font-semibold tracking-tight text-slate-950">{feature.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
