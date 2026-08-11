import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import SectionHeading from './SectionHeading';

const shots = [
  {
    title: 'Dashboard',
    description: 'Live timer, today\'s entries, attendance progress, projects, and working-ratio in one view.',
    accent: 'bg-blue-50',
    image: '/screenshots/dashboard.png',
  },
  {
    title: 'Monitoring',
    description: 'Employee insights, activity breakdowns, productive vs unproductive rankings, screenshots, and live tracking.',
    accent: 'bg-emerald-50',
    image: '/screenshots/monitoring.png',
  },
  {
    title: 'Attendance',
    description: 'Check-in history, monthly calendars, leave requests, and overtime/time-edit approval workflows.',
    accent: 'bg-violet-50',
    image: '/screenshots/attendance.png',
  },
  {
    title: 'Reports & Payroll',
    description: 'Exportable reports with user/group filters, payroll records, payouts, payslips, and invoices.',
    accent: 'bg-amber-50',
    image: '/screenshots/reports-payroll.png',
  },
];

function StackingCard({ shot, index, total }: { shot: typeof shots[0]; index: number; total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end end'],
  });

  const isLast = index === total - 1;
  const remaining = total - index - 1;

  const scale = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [1, 1 - remaining * 0.03, 1 - remaining * 0.03]
  );

  const y = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [0, remaining * 8, remaining * 8]
  );

  const opacity = useTransform(
    scrollYProgress,
    [0, 0.3, isLast ? 1 : 0.5],
    [1, 1, isLast ? 1 : 0.7]
  );

  return (
    <motion.div
      ref={ref}
      style={{
        scale,
        y,
        opacity,
        zIndex: index,
        top: `calc(50px + ${index * 16}px)`,
      }}
      className="sticky h-auto overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl"
    >
      {/* Browser chrome */}
      <div className={`relative overflow-hidden rounded-t-2xl ${shot.accent}`}>
        <div className="flex items-center gap-2 bg-slate-100 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <div className="ml-3 flex-1 rounded-md bg-white/70 px-3 py-1 text-[10px] text-slate-400">
            app.carevance.com
          </div>
        </div>

        <div className="relative h-56 overflow-hidden sm:h-64 lg:h-80">
          <img
            src={shot.image}
            alt={`${shot.title} — full page view of CareVance workforce management platform`}
            className="h-full w-full object-cover object-top"
            loading="lazy"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white/40 to-transparent" />
        </div>
      </div>

      <div className="px-6 pb-5 pt-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5D969D]">
          {shot.title}
        </span>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">
          {shot.description}
        </p>
      </div>
    </motion.div>
  );
}

export default function Screenshots() {
  return (
    <section id="screenshots" className="bg-surface-sunken px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Product showcase"
          title="See the platform in action"
          description="Explore the main surfaces managers and employees use every day."
        />

        <div className="relative mx-auto mt-8 max-w-4xl pb-8" style={{ height: `${shots.length * 420 + 200}px` }}>
          {shots.map((shot, index) => (
            <StackingCard key={shot.title} shot={shot} index={index} total={shots.length} />
          ))}
        </div>
      </div>
    </section>
  );
}
