import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, CalendarCheck, Clock4, Download, TrendingUp } from 'lucide-react';
import { desktopDownloadUrl } from '@/lib/runtimeConfig';
import { analytics } from '@/lib/analytics';
import { fadeSlideUp, staggerContainer, easeOut } from './animations';

export default function Hero() {
  return (
    <section className="overflow-hidden bg-white px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-14 lg:px-8 lg:pb-28 lg:pt-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <motion.div variants={staggerContainer} initial="hidden" animate="visible">
            <motion.div variants={fadeSlideUp} className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              All-in-one workforce platform
            </motion.div>

            <motion.h1 variants={fadeSlideUp} className="mt-6 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Know exactly what your{' '}
              <span className="text-blue-600">team is working on</span>
            </motion.h1>
            <motion.p variants={fadeSlideUp} className="mt-4 max-w-xl text-base leading-7 text-slate-500">
              Time tracking, employee monitoring, attendance, payroll, and HR operations — all in one platform that works on web and desktop.
            </motion.p>

            <motion.div variants={fadeSlideUp} className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/start-trial"
                onClick={() => { analytics.trackEvent('landing_cta_clicked', { location: 'hero', action: 'start-trial' }); analytics.trackEvent('start_trial_clicked', { location: 'hero' }); }}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow-md sm:w-auto"
              >
                Start Free Trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/contact-sales"
                onClick={() => { analytics.trackEvent('landing_cta_clicked', { location: 'hero', action: 'book-demo' }); analytics.trackEvent('book_demo_clicked', { location: 'hero' }); }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-md sm:w-auto"
              >
                Book Demo
              </Link>
              <a
                href={desktopDownloadUrl}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-md sm:w-auto"
              >
                <Download className="h-4 w-4" />
                Desktop App
              </a>
            </motion.div>

            <motion.div variants={fadeSlideUp} className="mt-10 grid gap-3 sm:grid-cols-3">
              {[
                { value: '10,000+', label: 'Active users', icon: TrendingUp },
                { value: '500+', label: 'Workspaces', icon: CalendarCheck },
                { value: '32%', label: 'Productivity lift', icon: BarChart3 },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <stat.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{stat.value}</p>
                      <p className="text-xs text-slate-500">{stat.label}</p>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: easeOut }}
            className="relative"
          >
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    </div>
                    <span className="ml-3 text-xs font-medium text-slate-400">Live Dashboard</span>
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Synced</span>
                </div>
              </div>
              <div className="p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-slate-500">Working ratio</p>
                        <p className="mt-1 text-2xl font-semibold text-slate-900">87%</p>
                      </div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                        <BarChart3 className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="mt-4 flex h-20 items-end gap-2">
                      {[48, 62, 55, 84, 76, 92, 88].map((h) => (
                        <div
                          key={h}
                          className="animate-bar-grow flex-1 rounded-t bg-blue-500"
                          style={{ '--bar-height': `${h}%`, animationDelay: `${0.3 + h * 0.005}s` } as React.CSSProperties}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {[
                      { icon: Clock4, label: 'Tracked today', value: '8h 24m' },
                      { icon: CalendarCheck, label: 'Attendance', value: '12 / 14' },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium text-slate-500">{item.label}</p>
                            <p className="mt-0.5 text-lg font-semibold text-slate-900">{item.value}</p>
                          </div>
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                            <item.icon className="h-4 w-4" />
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                      <p className="text-xs font-medium text-slate-500">Recent activity</p>
                      <div className="mt-3 space-y-2">
                        {[
                          ['09:10', 'Punch in'],
                          ['11:00', 'Activity log'],
                          ['14:30', 'Manager review'],
                        ].map(([time, title]) => (
                          <div key={time} className="flex items-center gap-3">
                            <span className="w-10 text-[11px] font-medium text-slate-400">{time}</span>
                            <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                            <span className="text-xs text-slate-600">{title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-3 -right-3 -z-10 h-48 w-48 rounded-full bg-blue-100/50 blur-2xl" />
            <div className="absolute -left-4 -top-4 -z-10 h-32 w-32 rounded-full bg-blue-50 blur-xl" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
