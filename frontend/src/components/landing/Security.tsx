import { motion } from 'framer-motion';
import { KeyRound, Lock, Server, ShieldCheck, UserCheck } from 'lucide-react';
import SectionHeading from './SectionHeading';
import { fadeSlideUp, staggerContainer, viewportOptions, getItemDelay } from './animations';

const items = [
  { icon: Lock, title: 'Data encryption', description: 'All data between desktop tracker, web app, and servers is encrypted. Activity data stays private.' },
  { icon: ShieldCheck, title: 'Org-scoped access', description: 'Every user, screenshot, and record is scoped to the organization. No cross-org data leakage.' },
  { icon: KeyRound, title: 'Role-based access control', description: 'Admin, manager, and employee roles with carefully scoped permissions.' },
  { icon: Server, title: 'Secure authentication', description: 'Bearer-token API auth with token usage tracking and permission checks on every request.' },
  { icon: UserCheck, title: 'Employee privacy controls', description: 'Employees see their own data. Screenshot policies and monitoring scopes are configurable per workspace.' },
];

export default function Security() {
  return (
    <section id="security" className="bg-[#f3f6fb] px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8 sm:py-10 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
            <SectionHeading
              eyebrow="Security & Trust"
              title="Enterprise-grade security built in"
              description="Your data is protected with encryption, RBAC, and org-scoped isolation."
              align="left"
            />
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={viewportOptions}
              className="grid gap-4 md:grid-cols-2"
            >
              {items.map((item, index) => (
                <motion.div
                  key={item.title}
                  variants={fadeSlideUp}
                  transition={getItemDelay(index)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-500">{item.description}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
