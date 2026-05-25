import { motion } from 'framer-motion';
import { BarChart3, Clock, Globe2, LifeBuoy, MessageSquare, Scan, Shield, Users } from 'lucide-react';
import SectionHeading from './SectionHeading';
import { fadeSlideUp, staggerContainer, viewportOptions, getItemDelay } from './animations';

const highlights = [
  { icon: Clock, title: 'Smart Time Tracking', description: 'One-click timer with project/task context, idle auto-pause, overtime calculation, and attendance check-in/out in one flow.' },
  { icon: Scan, title: 'Desktop Monitoring', description: 'Windows tracker captures active apps, URLs, idle periods, and screenshots — giving managers clear workday visibility.' },
  { icon: BarChart3, title: 'Productivity Intelligence', description: 'Tracked activity classified as productive, unproductive, or neutral. Dashboards surface trends and exportable reports.' },
  { icon: Users, title: 'Attendance & Leave', description: 'Punch in/out, leave requests, overtime edits, and manager approvals through a unified calendar and workflow.' },
  { icon: Globe2, title: 'Geo-Fencing', description: 'Define location boundaries for attendance — employees check in only when inside the designated geo-fence.' },
  { icon: MessageSquare, title: 'Team Chat', description: 'Built-in messaging tied to workspace and role structure. No need for a separate communication tool.' },
  { icon: Shield, title: 'Payroll & Compliance', description: 'Payroll records, payouts, payslips, and invoices — all within the same system as tracking and attendance.' },
  { icon: LifeBuoy, title: 'Role-Based Access', description: 'Admin, manager, and employee roles with org-scoped data access and bearer-token API security.' },
];

export default function DemoSection() {
  return (
    <section id="product" className="bg-[#f3f6fb] px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Product"
          title="All-in-one workforce management"
          description="From time tracking and monitoring to attendance, payroll, and compliance — everything in a single platform."
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOptions}
          className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {highlights.map((item, index) => (
            <motion.div
              key={item.title}
              variants={fadeSlideUp}
              transition={getItemDelay(index)}
              className="rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <item.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">{item.description}</p>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOptions}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-10 grid divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm sm:grid-cols-4 sm:divide-x sm:divide-y-0"
        >
          {[
            { label: 'Modules', value: '15+' },
            { label: 'Integration points', value: '8+' },
            { label: 'Report types', value: '6+' },
            { label: 'Supported roles', value: '3' },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col items-center bg-white px-4 py-7 text-center">
              <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
              <p className="mt-1 text-xs font-medium text-slate-500">{stat.label}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
