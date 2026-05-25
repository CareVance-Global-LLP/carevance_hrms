import { motion } from 'framer-motion';
import { DownloadCloud, Gauge, ScanSearch, UserPlus } from 'lucide-react';
import SectionHeading from './SectionHeading';
import { fadeSlideUp, staggerContainer, viewportOptions, getItemDelay } from './animations';

const steps = [
  { icon: UserPlus, title: 'Set up your workspace', description: 'Create your organization, invite team members, assign roles, and configure attendance rules. Ready in minutes.' },
  { icon: DownloadCloud, title: 'Install the desktop tracker', description: 'Team members download the Windows app, punch in, and start tracking. The tracker records apps, URLs, idle time, and screenshots.' },
  { icon: ScanSearch, title: 'Monitor in real time', description: 'Managers see live activity, productivity classifications, idle alerts, and attendance status from the web dashboard.' },
  { icon: Gauge, title: 'Review, approve, and export', description: 'Run reports, review screenshots, approve leave and overtime, process payroll, and export data for accounting.' },
];

export default function Workflow() {
  return (
    <section id="workflow" className="bg-[#f3f6fb] px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="How it works"
          title="From setup to insights in four steps"
          description="Get your team onboarded fast — the tracker handles data collection while managers focus on the big picture."
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOptions}
          className="relative mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              variants={fadeSlideUp}
              transition={getItemDelay(index, 0.08)}
              className="relative rounded-lg border border-slate-200 bg-white px-6 py-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <step.icon className="h-6 w-6" />
                </div>
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700">
                  {index + 1}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{step.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
