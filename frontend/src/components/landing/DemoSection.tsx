import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { AreaChart, MousePointerSquareDashed, TimerReset } from 'lucide-react';
import SectionHeading from './SectionHeading';

export default function DemoSection() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const y = useTransform(scrollYProgress, [0, 1], [50, -50]);

  return (
    <section id="product" className="px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14">
        <div>
          <SectionHeading
            eyebrow="Product overview"
            title="One system for monitoring, attendance, reporting, and HR operations"
            description="The repository implements a combined web app and desktop-assisted workflow for tracking work sessions, monitoring employee activity, managing attendance, and running admin tasks."
            align="left"
          />
          <div className="mt-8 space-y-4 sm:mt-10">
            {[
              {
                icon: TimerReset,
                title: 'Timer-led work tracking',
                description: 'Employees start a primary timer tied to attendance and optional project or task context.',
              },
              {
                icon: AreaChart,
                title: 'Management reporting',
                description: 'Admins and managers can review report dashboards, employee insights, attendance summaries, and CSV exports.',
              },
              {
                icon: MousePointerSquareDashed,
                title: 'Desktop-assisted monitoring',
                description: 'The Windows desktop tracker records active app or URL context, idle time, and screenshots for employees.',
              },
            ].map((item) => (
              <div key={item.title} className="glass-panel rounded-3xl p-4 sm:p-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-slate-950">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <motion.div ref={ref} style={{ y }} className="relative">
          <div className="absolute inset-0 rounded-[36px] bg-[linear-gradient(135deg,rgba(14,165,233,0.22),rgba(15,23,42,0.08))] blur-2xl" />
          <div className="glass-panel relative overflow-hidden rounded-[28px] p-4 sm:rounded-[36px] sm:p-7">
            <div className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-[0_30px_80px_-50px_rgba(15,23,42,0.35)] sm:rounded-[28px] sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-sky-700">Module coverage</p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">What the product actually contains</h3>
                </div>
                <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Web app + Windows tracker
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-500">Core operations modules</p>
                  <div className="mt-4 space-y-3">
                    {[
                      ['User management', 'Users + groups', 'Create users, assign roles, and manage report groups'],
                      ['Attendance', 'Punches + leave', 'Daily records, calendar views, leave requests, and time edits'],
                      ['Payroll / invoices', 'Finance workflows', 'Payroll records, payslips, payouts, and invoice actions'],
                    ].map(([name, score, meta]) => (
                      <div key={name} className="rounded-2xl bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <p className="font-medium text-slate-950">{name}</p>
                          <span className="text-sm font-semibold text-sky-700">{score}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">{meta}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-300">Monitoring inputs</p>
                        <p className="mt-2 text-2xl font-semibold sm:text-3xl">App, URL, idle, screenshot</p>
                      </div>
                      <div className="h-16 w-16 shrink-0 rounded-full border-[8px] border-cyan-300/35 border-t-cyan-300 sm:h-24 sm:w-24 sm:border-[10px]" />
                    </div>
                  </div>
                  <div className="rounded-3xl border border-slate-200 p-4">
                    <p className="text-sm font-medium text-slate-500">Report outputs</p>
                    <div className="mt-5 flex h-40 items-end gap-3">
                      {[
                        ['Daily', 88],
                        ['Weekly', 56],
                        ['Monthly', 78],
                        ['Attendance', 64],
                        ['Insights', 42],
                      ].map(([label, value]) => (
                        <div key={label} className="flex flex-1 flex-col items-center gap-3">
                          <div className="flex h-32 w-full items-end">
                            <div
                              className="w-full rounded-t-2xl bg-[linear-gradient(180deg,#0ea5e9,#bae6fd)]"
                              style={{ height: `${value}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-slate-500">{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
