import { motion } from 'framer-motion';
import { Activity, AppWindow, BarChart3, Bell, CalendarCheck, Clock3, FolderKanban, Gift, MapPin, MessageSquare, Receipt, Users } from 'lucide-react';
import SectionHeading from './SectionHeading';
import { fadeSlideUp, staggerContainer, viewportOptions, getItemDelay } from './animations';

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

export default function Features() {
  return (
    <section id="features" className="bg-white px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Features"
          title="Everything you need to run your workforce"
          description="Time tracking, monitoring, attendance, payroll, communication — all in one platform."
        />

        <div className="mt-10 space-y-10">
          {groups.map((group, gi) => (
            <motion.div
              key={group.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewportOptions}
              transition={{ duration: 0.5, delay: gi * 0.08 }}
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                  {group.title}
                </span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              <motion.div
                variants={staggerContainer}
                initial="hidden"
                whileInView="visible"
                viewport={viewportOptions}
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {group.items.map((item, fi) => (
                  <motion.div
                    key={item.title}
                    variants={fadeSlideUp}
                    transition={getItemDelay(fi)}
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
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
