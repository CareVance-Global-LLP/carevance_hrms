import { motion } from 'framer-motion';
import { BarChart3, Brain, Clock, Shield, TrendingUp, Users } from 'lucide-react';
import SectionHeading from './SectionHeading';
import { fadeSlideUp, staggerContainer, viewportOptions, getItemDelay } from './animations';

const items = [
  { icon: Brain, title: 'Automatic productivity insights', description: 'No manual timesheets. The tracker captures activity data and classifies it as productive or unproductive.' },
  { icon: TrendingUp, title: 'Reduce time theft', description: 'Idle detection, auto-stop timers, and screenshot verification ensure every minute reflects real work.' },
  { icon: Shield, title: 'Stay compliant', description: 'Attendance records, overtime, leave approvals, and payroll data in one auditable system with CSV export.' },
  { icon: Clock, title: 'Save hours on admin', description: 'Automated attendance, approval workflows, and payroll generation replace spreadsheets and emails.' },
  { icon: Users, title: 'Scale from 10 to 1,000+', description: 'Multi-role access, report groups, and org-scoped data make it easy to manage teams of any size.' },
  { icon: BarChart3, title: 'Data-driven decisions', description: 'Dashboards, employee rankings, efficiency scores, and trends give you the numbers to make informed decisions.' },
];

export default function Benefits() {
  return (
    <section className="bg-white px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Benefits"
          title="Why teams choose this platform"
          description="Real visibility into your team's work without adding complexity."
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOptions}
          className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {items.map((item, index) => (
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
      </div>
    </section>
  );
}
