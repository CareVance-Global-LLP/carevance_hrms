import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Activity, AppWindow, BarChart3, Bell, CalendarCheck, Clock3, FolderKanban, Gift, MapPin, MessageSquare, Receipt, Users } from 'lucide-react';
import SectionNumber from './SectionNumber';
import TextScramble from './TextScramble';

const groups = [
  {
    title: 'Time & Activity',
    items: [
      { icon: Clock3, title: 'Timer-Based Tracking', description: 'Start/stop timers with attendance and optional project or task context. Overtime calculated automatically.' },
      { icon: AppWindow, title: 'Desktop Monitoring', description: 'Windows tracker records active app names and URLs. Idle detection and auto-stop prevent time inflation.' },
      { icon: Activity, title: 'Productivity Classification', description: 'Activities classified as productive, unproductive, or neutral based on tool and domain rules.' },
    ],
  },
  {
    title: 'Workforce & Attendance',
    items: [
      { icon: CalendarCheck, title: 'Attendance & Leave', description: 'Daily check-in/out, leave requests, overtime edits, and manager approval workflows.' },
      { icon: MapPin, title: 'Geo-Fencing', description: 'Restrict attendance check-in to designated geographic boundaries for field and hybrid teams.' },
      { icon: Bell, title: 'Notifications & Alerts', description: 'Real-time alerts for approvals, leave updates, chat messages, and system events.' },
    ],
  },
  {
    title: 'Management & Finance',
    items: [
      { icon: BarChart3, title: 'Dashboards & Reports', description: 'Daily, weekly, and monthly reports with CSV export. Employee insights, rankings, and productivity trends.' },
      { icon: FolderKanban, title: 'Projects & Tasks', description: 'Organize work into projects and tasks. Track time against specific deliverables for accurate billing.' },
      { icon: Receipt, title: 'Payroll & Invoices', description: 'Generate payroll records, process payouts, issue payslips, and manage invoices from tracked hours.' },
    ],
  },
  {
    title: 'Collaboration & Admin',
    items: [
      { icon: MessageSquare, title: 'Team Chat', description: 'Built-in messaging within the workspace. Messages respect role and org boundaries.' },
      { icon: Users, title: 'User & Role Management', description: 'Admins create users, assign roles (admin/manager/employee), and organize into report groups.' },
      { icon: Gift, title: 'Onboarding & Invites', description: 'Streamlined workspace onboarding with email invites and auto-role assignment.' },
    ],
  },
];

function FeatureCard({ item, groupIndex }: { item: typeof groups[0]['items'][0]; groupIndex: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.9', 'start 0.4'],
  });

  const y = useTransform(scrollYProgress, [0, 1], [30, 0]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [0, 1]);

  const colors = [
    { bg: 'bg-gradient-to-br from-blue-50 to-blue-100/50', icon: 'bg-blue-100 text-blue-600', border: 'border-blue-100' },
    { bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100/50', icon: 'bg-emerald-100 text-emerald-600', border: 'border-emerald-100' },
    { bg: 'bg-gradient-to-br from-violet-50 to-violet-100/50', icon: 'bg-violet-100 text-violet-600', border: 'border-violet-100' },
    { bg: 'bg-gradient-to-br from-amber-50 to-amber-100/50', icon: 'bg-amber-100 text-amber-600', border: 'border-amber-100' },
  ][groupIndex % 4];

  return (
    <motion.div
      ref={ref}
      style={{ y, opacity }}
      whileHover={{ y: -6, transition: { type: 'spring', stiffness: 300, damping: 20 } }}
      className={`relative overflow-hidden rounded-2xl border ${colors.border} ${colors.bg} p-5 transition-shadow duration-300 hover:shadow-lg sm:p-6`}
    >
      <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${colors.icon}`}>
        <item.icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3.5 text-[15px] font-bold text-slate-900">{item.title}</h3>
      <p className="mt-1.5 text-[13px] leading-5.5 text-slate-600">{item.description}</p>
    </motion.div>
  );
}

export default function Features() {
  return (
    <section id="features" className="bg-white px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionNumber number={2} label="Features" className="mb-6" />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            Features
          </span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
          >
            <TextScramble text="Everything you need to run your workforce" speed={25} delay={200} />
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl text-base leading-7 text-slate-500"
          >
            Time tracking, monitoring, attendance, payroll, communication — all in one platform.
          </motion.p>
        </div>

        <div className="mt-10 space-y-12">
          {groups.map((group, gi) => {
            const isEven = gi % 2 === 0;
            return (
              <motion.div
                key={group.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.6, delay: gi * 0.05, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* Flowing group header */}
                <div className={`mb-5 flex items-center gap-4 ${isEven ? '' : 'flex-row-reverse'}`}>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
                  <motion.span
                    initial={{ scale: 0.8, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 0.2 }}
                    className="flex-shrink-0 rounded-full border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600"
                  >
                    {group.title}
                  </motion.span>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
                </div>

                {/* Asymmetric grid */}
                <div className={`grid gap-4 ${gi % 2 === 0 ? 'sm:grid-cols-[1.2fr_1fr_1fr]' : 'sm:grid-cols-[1fr_1fr_1.2fr]'}`}>
                  {group.items.map((item) => (
                    <FeatureCard key={item.title} item={item} groupIndex={gi} />
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
