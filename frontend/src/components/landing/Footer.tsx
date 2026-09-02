import { Link } from 'react-router-dom';
import { Github, Linkedin, Twitter } from 'lucide-react';
import { motion, type Variants } from 'framer-motion';
import BrandLogo from '@/components/branding/BrandLogo';
import { useConsent } from '@/contexts/ConsentContext';

const groups = [
  { title: 'Product', links: [
    { label: 'Pricing', to: '/pricing' },
    { label: 'Start Trial', to: '/start-trial' },
    { label: 'Book Demo', to: '/contact-sales' },
  ] },
  { title: 'Workspace', links: [
    { label: 'Dashboard', to: '/login' },
    { label: 'Sign In', to: '/login' },
    { label: 'Owner Signup', to: '/signup-owner' },
  ] },
  { title: 'Company', links: [
    { label: 'Support', to: '/support' },
    { label: 'Contact Sales', to: '/contact-sales' },
    { label: 'Privacy Policy', to: '/privacy' },
    { label: 'Terms & Conditions', to: '/terms' },
  ] },
];

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

export default function Footer() {
  const { openPreferences } = useConsent();

  return (
    <footer className="bg-surface-sunken px-4 pb-8 pt-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8 sm:py-10">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={stagger}
          className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]"
        >
          <motion.div variants={fadeUp}>
            <Link to="/" className="inline-flex w-full max-w-[14rem] items-center">
              <BrandLogo variant="full" size="sm" className="max-w-full" />
            </Link>
            <p className="mt-4 max-w-md text-sm leading-7 text-slate-500">
              Time tracking, employee monitoring, attendance, payroll, and HR operations — all in one platform.
            </p>
            <div className="mt-5 flex items-center gap-3 text-slate-500">
              {/*
                THE LABEL IS WRITTEN OUT, not derived from `Icon.name`.

                It used to be `aria-label={Icon.name}`, which works in
                development and silently breaks in production: the bundler
                minifies component function names, so the attribute ships empty
                and Lighthouse reports "links do not have a discernible name" —
                three tab stops that announce as nothing. A bug that only exists
                in the build nobody runs locally is the kind worth pinning down
                with a literal.

                TODO(founder): these all point at `/`. They need the real
                profile URLs, or they should be removed — a social icon that
                reloads the homepage is worse than no icon.
              */}
              {[
                { Icon: Twitter, label: 'CareVance on X' },
                { Icon: Linkedin, label: 'CareVance on LinkedIn' },
                { Icon: Github, label: 'CareVance on GitHub' },
              ].map(({ Icon, label }) => (
                <a
                  key={label}
                  href="/"
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 transition-all duration-200 hover:border-slate-300 hover:text-slate-700 hover:shadow-sm"
                  aria-label={label}
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </motion.div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {groups.map((group) => (
              <motion.div key={group.title} variants={fadeUp}>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{group.title}</p>
                <div className="mt-3 space-y-2.5">
                  {group.links.map((link) => (
                    <Link key={link.label} to={link.to} className="block text-sm text-slate-500 transition-colors duration-200 hover:text-slate-900">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <div className="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-500">&copy; {new Date().getFullYear()} CareVance. All rights reserved.</p>
          <button
            type="button"
            onClick={openPreferences}
            className="w-fit font-semibold text-blue-600 underline-offset-4 transition-colors duration-200 hover:text-slate-900 hover:underline"
          >
            Cookie Preferences
          </button>
        </div>
      </div>
    </footer>
  );
}
