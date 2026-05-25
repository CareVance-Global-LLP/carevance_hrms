import { motion } from 'framer-motion';
import SectionHeading from './SectionHeading';
import { staggerContainer, viewportOptions, fadeSlideUp, getItemDelay } from './animations';

const shots = [
  { title: 'Dashboard', description: 'Live timer, today\'s entries, attendance progress, projects, and working-ratio in one view.', accent: 'bg-blue-50' },
  { title: 'Monitoring', description: 'Employee insights, activity breakdowns, productive vs unproductive rankings, screenshots, and live tracking.', accent: 'bg-emerald-50' },
  { title: 'Attendance', description: 'Check-in history, monthly calendars, leave requests, and overtime/time-edit approval workflows.', accent: 'bg-violet-50' },
  { title: 'Reports & Payroll', description: 'Exportable reports with user/group filters, payroll records, payouts, payslips, and invoices.', accent: 'bg-amber-50' },
];

export default function Screenshots() {
  return (
    <section id="screenshots" className="bg-white px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Product showcase"
          title="See the platform in action"
          description="Explore the main surfaces managers and employees use every day."
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOptions}
          className="mt-10 grid gap-5 sm:grid-cols-2"
        >
          {shots.map((shot, index) => (
            <motion.div
              key={shot.title}
              variants={fadeSlideUp}
              transition={getItemDelay(index)}
              className="rounded-lg border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className={`flex h-40 items-center justify-center rounded-t-lg ${shot.accent}`}>
                <div className="rounded-lg border border-slate-200 bg-white px-8 py-6 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-red-400" />
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  </div>
                  <div className="mt-4 h-16 w-48 rounded bg-slate-100" />
                  <div className="mt-3 flex gap-2">
                    <div className="h-4 flex-1 rounded bg-slate-100" />
                    <div className="h-4 w-12 rounded bg-slate-100" />
                  </div>
                </div>
              </div>
              <div className="px-5 pb-5 pt-4">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">{shot.title}</span>
                <p className="mt-1.5 text-sm leading-6 text-slate-500">{shot.description}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
