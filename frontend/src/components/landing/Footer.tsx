import { Link } from 'react-router-dom';
import { Github, Linkedin, Twitter } from 'lucide-react';
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

export default function Footer() {
  const { openPreferences } = useConsent();

  return (
    <footer className="bg-[#f3f6fb] px-4 pb-8 pt-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl rounded-lg border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8 sm:py-10">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <Link to="/" className="inline-flex w-full max-w-[14rem] items-center">
              <BrandLogo variant="full" size="sm" className="max-w-full" />
            </Link>
            <p className="mt-4 max-w-md text-sm leading-7 text-slate-500">
              Time tracking, employee monitoring, attendance, payroll, and HR operations — all in one platform.
            </p>
            <div className="mt-5 flex items-center gap-3 text-slate-400">
              {[Twitter, Linkedin, Github].map((Icon) => (
                <a
                  key={Icon.displayName || Icon.name}
                  href="/"
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 transition hover:border-slate-300 hover:text-slate-700"
                  aria-label={Icon.name}
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{group.title}</p>
                <div className="mt-3 space-y-2.5">
                  {group.links.map((link) => (
                    <Link key={link.label} to={link.to} className="block text-sm text-slate-500 transition hover:text-slate-900">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-400">&copy; {new Date().getFullYear()} CareVance. All rights reserved.</p>
          <button
            type="button"
            onClick={openPreferences}
            className="w-fit font-semibold text-blue-600 underline-offset-4 transition hover:text-slate-900 hover:underline"
          >
            Cookie Preferences
          </button>
        </div>
      </div>
    </footer>
  );
}
