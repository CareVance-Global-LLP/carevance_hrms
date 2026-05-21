import { motion } from 'framer-motion';
import SectionHeading from './SectionHeading';

const shots = [
  {
    title: 'Dashboard',
    description: 'The dashboard shows live timer state, today’s entries, attendance progress, projects, and working-ratio productivity.',
    accent: 'from-sky-500/20 to-cyan-200/40',
  },
  {
    title: 'Monitoring',
    description: 'The monitoring page combines employee insights, activity breakdowns, productive vs unproductive tool rankings, and screenshots.',
    accent: 'from-emerald-500/20 to-lime-200/40',
  },
  {
    title: 'Attendance',
    description: 'Attendance views include check-in history, monthly calendars, leave requests, and overtime or time-edit approval workflows.',
    accent: 'from-violet-500/20 to-fuchsia-200/40',
  },
  {
    title: 'Reports and payroll',
    description: 'Managers can export reports, filter by user or group, and work through payroll records, payouts, and payslips.',
    accent: 'from-amber-500/20 to-orange-200/40',
  },
];

export default function Screenshots() {
  return (
    <section id="screenshots" className="px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Showcase"
          title="Main product surfaces in the current application"
          description="These cards correspond to the actual frontend pages that are already wired into the app."
        />
        <div className="mt-10 grid gap-5 sm:mt-14 sm:gap-6 lg:grid-cols-2">
          {shots.map((shot, index) => (
            <motion.div
              key={shot.title}
              initial={{ opacity: 0, y: 30, scale: 0.98 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, delay: index * 0.08 }}
              className="group relative overflow-hidden rounded-[28px] border border-white/60 bg-white/75 p-4 shadow-[0_28px_70px_-42px_rgba(15,23,42,0.8)] backdrop-blur sm:rounded-[32px] sm:p-5"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${shot.accent} opacity-80 transition duration-500 group-hover:scale-110`} />
              <div className="relative rounded-[22px] border border-slate-200/80 bg-slate-950 p-4 text-white sm:rounded-[26px] sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.28em] text-white/55">{shot.title}</p>
                    <p className="mt-2 text-lg font-semibold">Operational visibility without clutter</p>
                  </div>
                  <div className="w-fit rounded-full bg-white/10 px-3 py-1 text-xs">Live</div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                    <div className="flex h-28 items-end gap-2 sm:h-36 sm:gap-3">
                      {[45, 62, 74, 58, 88, 81].map((value) => (
                        <div key={value} className="flex flex-1 items-end">
                          <div
                            className="w-full rounded-t-2xl bg-[linear-gradient(180deg,rgba(103,232,249,0.95),rgba(14,165,233,0.28))]"
                            style={{ height: `${value}%` }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {[78, 84, 91, 76].map((metric, metricIndex) => (
                      <div key={`${shot.title}-${metricIndex}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <p className="text-sm text-white/65">
                          {['Tracked time', 'Idle review', 'Approvals', 'Exports'][metricIndex]}
                        </p>
                        <p className="mt-2 text-xl font-semibold">{metric}%</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="relative px-2 pb-2 pt-5">
                <h3 className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{shot.title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">{shot.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
