import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { DownloadCloud, Gauge, ScanSearch, UserPlus } from 'lucide-react';
import { viewportOptions } from './animations';
import SectionNumber from './SectionNumber';

const steps = [
  { icon: UserPlus, title: 'Set up your workspace', description: 'Create your organization, invite team members, assign roles, and configure attendance rules. Ready in minutes.' },
  { icon: DownloadCloud, title: 'Install the desktop tracker', description: 'Team members download the Windows app, punch in, and start tracking. The tracker records apps, URLs, idle time, and screenshots.' },
  { icon: ScanSearch, title: 'Monitor in real time', description: 'Managers see live activity, productivity classifications, idle alerts, and attendance status from the web dashboard.' },
  { icon: Gauge, title: 'Review, approve, and export', description: 'Run reports, review screenshots, approve leave and overtime, process payroll, and export data for accounting.' },
];

function TimelineLine() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.7', 'start 0.2'],
  });
  const scaleY = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <div ref={ref} className="absolute left-6 top-0 bottom-0 hidden lg:block">
      <motion.div
        className="h-full w-0.5 origin-top bg-gradient-to-b from-blue-400 to-blue-600"
        style={{ scaleY }}
      />
    </div>
  );
}

export default function Workflow() {
  return (
    <section id="workflow" className="bg-[#f3f6fb] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionNumber number={3} label="Workflow" className="mb-6" />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            How it works
          </span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
          >
            From setup to insights in four steps
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl text-base leading-7 text-slate-500"
          >
            Get your team onboarded fast — the tracker handles data collection while managers focus on the big picture.
          </motion.p>
        </div>

        <div className="relative mt-14">
          <TimelineLine />

          <div className="space-y-8 lg:space-y-12">
            {steps.map((step, index) => {
              const isEven = index % 2 === 0;
              return (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, x: isEven ? -48 : 48 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={viewportOptions}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className={`relative flex items-start gap-6 lg:gap-12 ${isEven ? 'lg:flex-row' : 'lg:flex-row-reverse'}`}
                >
                  {/* Step number dot (visible on lg) */}
                  <div className="relative z-10 hidden lg:flex flex-shrink-0">
                    <motion.div
                      initial={{ scale: 0 }}
                      whileInView={{ scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ type: 'spring', stiffness: 500, damping: 25, delay: 0.2 }}
                      className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-200 bg-white text-sm font-bold text-blue-600 shadow-sm"
                    >
                      {index + 1}
                    </motion.div>
                  </div>

                  {/* Mobile step number */}
                  <div className="flex-shrink-0 lg:hidden">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white shadow-sm">
                      {index + 1}
                    </div>
                  </div>

                  {/* Card */}
                  <motion.div
                    whileHover={{ y: -4, boxShadow: '0 20px 60px -15px rgba(93, 150, 157, 0.2)' }}
                    transition={{ type: 'spring', stiffness: 350, damping: 20 }}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-6 py-6 shadow-sm"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                        <step.icon className="h-6 w-6" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">{step.title}</h3>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-500">{step.description}</p>
                  </motion.div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
