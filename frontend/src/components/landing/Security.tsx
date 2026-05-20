import { motion } from 'framer-motion';
import { KeyRound, Lock, ShieldCheck, UserRoundCog } from 'lucide-react';
import SectionHeading from './SectionHeading';

const securityItems = [
  {
    icon: Lock,
    title: 'Bearer-token API authentication',
    description: 'Protected API routes require a personal access token and update token usage and last-seen information on each request.',
  },
  {
    icon: ShieldCheck,
    title: 'Organization-scoped data access',
    description: 'Controllers consistently scope users, screenshots, activities, invoices, payroll, and reports to the current organization.',
  },
  {
    icon: KeyRound,
    title: 'Role-gated admin operations',
    description: 'Admin and manager roles are required for monitoring, report filtering, payroll workflows, and user-management actions.',
  },
  {
    icon: UserRoundCog,
    title: 'Separate employee and management views',
    description: 'Employees see their own attendance, chat, settings, and time data, while managers can review team-wide operational workflows.',
  },
];

export default function Security() {
  return (
    <section id="security" className="px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl rounded-[28px] border border-slate-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(240,249,255,0.92))] p-6 shadow-[0_32px_90px_-54px_rgba(15,23,42,0.85)] backdrop-blur sm:rounded-[36px] sm:p-10 lg:p-12">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <SectionHeading
            eyebrow="Security"
            title="Access control and data boundaries implemented in code"
            description="This section only reflects controls that are visible in the repository: token auth, org scoping, and role-based access checks."
            align="left"
          />
          <div className="grid gap-4 sm:gap-5 sm:grid-cols-2">
            {securityItems.map((item, index) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.45, delay: index * 0.06 }}
                className="rounded-[28px] border border-slate-200 bg-white/80 p-5 sm:p-6"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <item.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-slate-950">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
