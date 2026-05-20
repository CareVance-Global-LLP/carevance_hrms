import { motion, Variants } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, CalendarRange, Clock4, Download } from 'lucide-react';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import { desktopDownloadUrl } from '@/lib/runtimeConfig';
import { analytics } from '@/lib/analytics';

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
    },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } },
};

export default function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-8 sm:px-6 sm:pb-28 sm:pt-12 lg:px-8 lg:pb-36 lg:pt-16">
      <div className="hero-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.3),transparent_55%)]" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-300/20 blur-3xl" />

      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.03fr_0.97fr] lg:gap-18">
        <motion.div variants={container} initial="hidden" animate="show" className="relative z-10">
          <motion.h1
            variants={item}
            className="max-w-4xl text-3xl font-semibold tracking-[-0.065em] text-slate-950 sm:text-6xl lg:pt-2 lg:text-[5.2rem] lg:leading-[0.95]"
          >
            Monitor team productivity
            <span className="block bg-[linear-gradient(135deg,#020617_0%,#0f172a_18%,#0369a1_52%,#22d3ee_100%)] bg-clip-text pb-2 text-transparent">
              and work activity in real time
            </span>
          </motion.h1>
          <motion.p
            variants={item}
            className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:mt-7 sm:text-[1.22rem] sm:leading-8"
          >
            CareVance HRMS combines employee monitoring, attendance, reporting, payroll operations, and internal admin workflows in one system for managers and operations teams.
          </motion.p>

          <motion.div variants={item} className="mt-8 flex flex-col gap-3 sm:mt-11 sm:gap-4 lg:flex-row">
            <Link
              to="/start-trial"
              onClick={() => {
                analytics.trackEvent('landing_cta_clicked', { location: 'hero', action: 'start-trial' });
                analytics.trackEvent('start_trial_clicked', { location: 'hero' });
              }}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition duration-300 hover:-translate-y-0.5 sm:w-auto"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4 transition duration-300 group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/contact-sales"
              onClick={() => {
                analytics.trackEvent('landing_cta_clicked', { location: 'hero', action: 'book-demo' });
                analytics.trackEvent('book_demo_clicked', { location: 'hero' });
              }}
              className="inline-flex w-full items-center justify-center rounded-full border border-slate-300/80 bg-white/80 px-6 py-3.5 text-sm font-semibold text-slate-900 shadow-[0_16px_35px_-26px_rgba(15,23,42,0.45)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-slate-950 hover:bg-white sm:w-auto"
            >
              Book Demo
            </Link>
            <a
              href={desktopDownloadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-sky-200/80 bg-sky-50/90 px-6 py-3.5 text-sm font-semibold text-sky-900 shadow-[0_16px_35px_-26px_rgba(14,165,233,0.4)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:bg-white sm:w-auto"
            >
              <Download className="h-4 w-4" />
              Download Desktop App
            </a>
          </motion.div>

          <motion.p variants={item} className="mt-5 text-sm font-medium text-slate-500">
            Includes workspace-owner signup, invite-only member onboarding, and optional Windows desktop tracker handoff
          </motion.p>

          <motion.div variants={item} className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-3">
            {[
              { value: 'Live', label: 'Timer, activity, and screenshot capture while work is in progress' },
              { value: 'Admin', label: 'Monitoring, user management, report groups, payroll, and invoices' },
              { value: 'HRMS', label: 'Attendance, leave, time-edit approvals, notifications, and settings' },
            ].map((stat) => (
              <div key={stat.label} className="glass-panel premium-ring rounded-[28px] px-5 py-6">
                <p className="text-3xl font-semibold tracking-[-0.05em] text-slate-950">{stat.value}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="relative lg:pl-4"
        >
          <div className="absolute -right-6 top-10 hidden h-36 w-36 rounded-full bg-sky-300/30 blur-3xl lg:block" />
          <div className="glass-panel premium-ring noise-overlay relative overflow-hidden rounded-[28px] border border-white/70 p-3 shadow-[0_45px_140px_-56px_rgba(14,165,233,0.55)] sm:rounded-[36px] sm:p-6">
            <div className="absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,rgba(125,211,252,0.18),transparent)]" />
            <AdaptiveSurface
              className="relative rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,#06111f_0%,#020617_100%)] p-4 text-white shadow-2xl shadow-slate-950/20 sm:rounded-[30px] sm:p-5"
              tone="dark"
              backgroundColor="#020617"
              data-navbar-contrast="dark"
            >
              <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="contrast-text-accent text-xs uppercase tracking-[0.3em]">Live overview</p>
                  <p className="contrast-text-primary mt-2 text-lg font-semibold sm:text-xl">Time, attendance, and monitoring dashboard</p>
                </div>
                <div className="w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs contrast-text-secondary">
                  Web + desktop sync
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm contrast-text-secondary">Productivity score</p>
                      <p className="contrast-text-primary mt-2 text-3xl font-semibold sm:text-4xl">Working ratio</p>
                    </div>
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                      <BarChart3 className="h-7 w-7" />
                    </div>
                  </div>
                  <div className="mt-6 flex h-28 items-end gap-3 sm:h-36">
                    {[48, 62, 55, 84, 76, 92, 88].map((height, index) => (
                      <motion.div
                        key={height}
                        initial={{ height: 0 }}
                        animate={{ height: `${height}%` }}
                        transition={{ duration: 0.8, delay: 0.35 + index * 0.06 }}
                        className="flex-1 rounded-t-2xl bg-[linear-gradient(180deg,rgba(103,232,249,0.95),rgba(14,165,233,0.35))]"
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-200">
                        <Clock4 className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm contrast-text-secondary">Attendance worked</p>
                        <p className="contrast-text-primary text-lg font-semibold sm:text-xl">Open shift tracking</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-200">
                        <CalendarRange className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm contrast-text-secondary">Attendance & leave</p>
                        <p className="contrast-text-primary text-lg font-semibold sm:text-xl">Calendar and approval workflows</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm contrast-text-secondary">Activity timeline</p>
                    <div className="mt-4 space-y-3">
                      {[
                        ['09:10', 'Punch in', 'Attendance record and primary timer start together'],
                        ['11:00', 'Activity log', 'Desktop tracker records app, URL, or idle telemetry'],
                        ['14:30', 'Manager review', 'Reports, screenshots, and approvals update from live data'],
                      ].map(([time, title, meta]) => (
                        <div key={time} className="flex gap-3">
                          <div className="w-12 shrink-0 pt-1 text-xs font-medium text-cyan-200">{time}</div>
                          <div className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                            <p className="contrast-text-primary text-sm font-medium">{title}</p>
                            <p className="contrast-text-muted mt-1 text-xs">{meta}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </AdaptiveSurface>
          </div>

        </motion.div>
      </div>
    </section>
  );
}
