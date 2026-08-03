import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { KeyRound, Lock, Server, ShieldCheck, UserCheck } from 'lucide-react';
import { viewportOptions, cardHoverEnhanced } from './animations';

const items = [
  { icon: Lock, title: 'Data encryption', description: 'All data between desktop tracker, web app, and servers is encrypted. Activity data stays private.' },
  { icon: ShieldCheck, title: 'Org-scoped access', description: 'Every user, screenshot, and record is scoped to the organization. No cross-org data leakage.' },
  { icon: KeyRound, title: 'Role-based access control', description: 'Admin, manager, and employee roles with carefully scoped permissions.' },
  { icon: Server, title: 'Secure authentication', description: 'Bearer-token API auth with token usage tracking and permission checks on every request.' },
  { icon: UserCheck, title: 'Employee privacy controls', description: 'Employees see their own data. Screenshot policies and monitoring scopes are configurable per workspace.' },
];

function ShieldSVG() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'start 0.3'],
  });
  const pathLength = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <div ref={ref} className="relative mx-auto mb-8 flex h-32 w-32 items-center justify-center lg:mx-0 lg:mb-10">
      <svg viewBox="0 0 100 100" className="h-24 w-24">
        <motion.path
          d="M50 5 L90 25 L90 55 C90 75 70 92 50 98 C30 92 10 75 10 55 L10 25 Z"
          fill="none"
          stroke="#5D969D"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pathLength }}
        />
        <motion.path
          d="M35 50 L45 60 L65 40"
          fill="none"
          stroke="#5D969D"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pathLength }}
        />
      </svg>
    </div>
  );
}

export default function Security() {
  return (
    <section id="security" className="bg-[#f3f6fb] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8 sm:py-10 lg:px-10">
          <ShieldSVG />

          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
            {/* Left: heading */}
            <div className="flex flex-col gap-4">
              <span className="inline-flex items-center self-start rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                Security & Trust
              </span>
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
              >
                Enterprise-grade security built in
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="text-base leading-7 text-slate-500"
              >
                Your data is protected with encryption, RBAC, and org-scoped isolation.
              </motion.p>
            </div>

            {/* Right: feature grid */}
            <div className="grid gap-4 md:grid-cols-2">
              {items.map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={viewportOptions}
                  transition={{ duration: 0.5, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                  {...cardHoverEnhanced}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-all duration-300"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <h3 className="mt-3 text-sm font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-500">{item.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
