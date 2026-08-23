import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertCircle, ArrowRight, LifeBuoy, Mail, MessageSquareWarning } from 'lucide-react';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import LandingPageChatBubble from '@/components/LandingPageChatBubble';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import { SelectInput } from '@/components/ui/FormField';
import PublicPageTransition from '@/components/public/PublicPageTransition';
import { useAuth } from '@/contexts/AuthContext';
import { supportApi } from '@/services/api';
import { analytics } from '@/lib/analytics';
import { salesContactEmail, supportContactEmail } from '@/lib/runtimeConfig';

const issueCategories = [
  { value: 'bug', label: 'Bug' },
  { value: 'ui', label: 'UI issue' },
  { value: 'performance', label: 'Performance' },
  { value: 'billing', label: 'Billing' },
  { value: 'account', label: 'Account access' },
  { value: 'other', label: 'Other' },
] as const;

export default function SupportPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [issueCategory, setIssueCategory] = useState<(typeof issueCategories)[number]['value']>('bug');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setName(user?.name || '');
    setEmail(user?.email || '');
  }, [user?.email, user?.name]);

  const currentPath = `${location.pathname}${location.search}`;
  const supportMailto = `mailto:${supportContactEmail}?subject=CareVance%20Support`;
  const salesMailto = `mailto:${salesContactEmail}?subject=CareVance%20Sales`;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSuccessMessage('');
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const response = await supportApi.submitBugReport({
        name: name.trim() || undefined,
        email: email.trim(),
        issue_category: issueCategory,
        summary: summary.trim(),
        description: description.trim(),
        current_path: currentPath,
      });

      analytics.trackEvent('bug_report_submitted', {
        issue_category: issueCategory,
        source: user ? 'authenticated-support-page' : 'public-support-page',
      });

      setSuccessMessage(response.data.message || 'Thanks. Your report has been submitted.');
      setSummary('');
      setDescription('');
      if (!user) {
        setName('');
      }
    } catch (error: any) {
      setErrorMessage(error?.response?.data?.message || 'Unable to submit your report right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative overflow-x-clip page-canvas text-slate-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.35),transparent_58%)]" />
      <Navbar />

      <PublicPageTransition>
        <section className="px-4 pb-16 pt-16 sm:px-6 sm:pt-22 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-sky-700">Support</p>
              <h1 className="mt-5 text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-[4.4rem] sm:leading-[0.94]">
                Reach support or send a bug report without leaving the CareVance flow
              </h1>
              <p className="mt-6 text-base leading-8 text-slate-600 sm:text-[1.08rem]">
                Use the support email for general help, or submit a product issue with the route you were on so the team
                can review it faster.
              </p>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
              <AdaptiveSurface
                className="rounded-[34px] border border-white/80 bg-white/88 p-6 shadow-[0_36px_90px_-48px_rgba(15,23,42,0.32)] sm:p-8"
                tone="light"
                backgroundColor="rgba(255,255,255,0.88)"
              >
                <div className="rounded-[26px] border border-slate-200/80 bg-slate-50/85 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Support routing</p>
                  <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
                    <li>Use support for account questions, broken flows, UI issues, and operational help.</li>
                    <li>Use sales when you need rollout planning, pricing guidance, or onboarding help.</li>
                    <li>Bug reports include the current route automatically so troubleshooting starts with better context.</li>
                  </ul>
                </div>

                <div className="mt-6 grid gap-4">
                  <a
                    href={supportMailto}
                    onClick={() =>
                      analytics.trackEvent('contact_support_clicked', {
                        source: 'support-page-email',
                      })
                    }
                    className="rounded-[26px] border border-slate-200/90 bg-white p-5 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.22)] transition duration-300 hover:-translate-y-0.5"
                  >
                    <Mail className="h-5 w-5 text-sky-700" />
                    <p className="mt-4 text-lg font-semibold tracking-[-0.03em] text-slate-950">Email support</p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{supportContactEmail}</p>
                  </a>

                  <a
                    href={salesMailto}
                    className="rounded-[26px] border border-slate-200/90 bg-white p-5 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.22)] transition duration-300 hover:-translate-y-0.5"
                  >
                    <LifeBuoy className="h-5 w-5 text-sky-700" />
                    <p className="mt-4 text-lg font-semibold tracking-[-0.03em] text-slate-950">Need sales instead?</p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{salesContactEmail}</p>
                  </a>
                </div>

                <div className="mt-6 rounded-[26px] border border-slate-200/80 bg-slate-50/80 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Current route</p>
                  <p className="mt-2 text-sm break-all text-slate-600">{currentPath}</p>
                </div>
              </AdaptiveSurface>

              <AdaptiveSurface
                id="bug-report"
                className="rounded-[34px] border border-slate-200/85 bg-[linear-gradient(180deg,#06111f_0%,#020617_100%)] p-6 text-white shadow-[0_36px_90px_-42px_rgba(15,23,42,0.8)] sm:p-8"
                tone="dark"
                backgroundColor="#020617"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-12 w-12 items-center justify-center rounded-[18px] bg-white/10">
                    <MessageSquareWarning className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="contrast-text-accent text-xs font-semibold uppercase tracking-[0.3em]">Bug report</p>
                    <h2 className="contrast-text-primary mt-3 text-2xl font-semibold tracking-[-0.04em]">
                      Share what broke and where it happened
                    </h2>
                    <p className="contrast-text-secondary mt-3 text-sm leading-7">
                      This form is intentionally lightweight so users can report issues without disrupting current payroll,
                      invite, login, or dashboard flows.
                    </p>
                  </div>
                </div>

                {successMessage ? (
                  <div className="mt-6 rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-4 text-sm text-emerald-100">
                    {successMessage}
                  </div>
                ) : null}

                {errorMessage ? (
                  <div className="mt-6 flex items-start gap-3 rounded-[24px] border border-rose-400/20 bg-rose-400/10 px-4 py-4 text-sm text-rose-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{errorMessage}</p>
                  </div>
                ) : null}

                <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="support-name" className="mb-2 block text-sm font-semibold text-white">
                      Name {user ? '(optional)' : ''}
                    </label>
                    <input
                      id="support-name"
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required={!user}
                      className="block w-full rounded-[22px] border border-white/10 bg-white px-4 py-3.5 text-sm text-slate-950 placeholder:text-slate-500 outline-none transition focus:border-cyan-200/50 focus:ring-2 focus:ring-cyan-200/20"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label htmlFor="support-email" className="mb-2 block text-sm font-semibold text-white">
                      Email
                    </label>
                    <input
                      id="support-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      className="block w-full rounded-[22px] border border-white/10 bg-white px-4 py-3.5 text-sm text-slate-950 placeholder:text-slate-500 outline-none transition focus:border-cyan-200/50 focus:ring-2 focus:ring-cyan-200/20"
                      placeholder="you@company.com"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-[0.75fr_1.25fr]">
                  <div>
                    <label htmlFor="issue-category" className="mb-2 block text-sm font-semibold text-white">
                      Issue category
                    </label>
                    <SelectInput
                      id="issue-category"
                      value={issueCategory}
                      onChange={(event) => setIssueCategory(event.target.value as (typeof issueCategories)[number]['value'])}
                      className="block w-full border-white/10 bg-white px-4 py-3.5 text-slate-950 shadow-none focus:border-cyan-200/50 focus:ring-cyan-200/20"
                    >
                      {issueCategories.map((category) => (
                          <option key={category.value} value={category.value}>
                            {category.label}
                          </option>
                        ))}
                      </SelectInput>
                  </div>

                  <div>
                    <label htmlFor="support-summary" className="mb-2 block text-sm font-semibold text-white">
                      Summary
                    </label>
                    <input
                      id="support-summary"
                      type="text"
                      value={summary}
                      onChange={(event) => setSummary(event.target.value)}
                      required
                      className="block w-full rounded-[22px] border border-white/10 bg-white px-4 py-3.5 text-sm text-slate-950 placeholder:text-slate-500 outline-none transition focus:border-cyan-200/50 focus:ring-2 focus:ring-cyan-200/20"
                      placeholder="Short description of the issue"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="support-description" className="mb-2 block text-sm font-semibold text-white">
                    Description
                  </label>
                  <textarea
                    id="support-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    required
                    rows={6}
                    className="block w-full rounded-[24px] border border-white/10 bg-white px-4 py-3.5 text-sm text-slate-950 placeholder:text-slate-500 outline-none transition focus:border-cyan-200/50 focus:ring-2 focus:ring-cyan-200/20"
                    placeholder="Tell us what happened, what you expected, and any steps that reproduce it."
                  />
                </div>

                <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-sm leading-7 contrast-text-secondary">
                  Route auto-captured for this submission: <span className="font-semibold text-white">{currentPath}</span>
                </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-slate-950 transition duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit report'}
                      {!isSubmitting ? <ArrowRight className="h-4 w-4" /> : null}
                    </button>
                    <Link
                      to="/contact-sales"
                      className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-5 py-3.5 text-sm font-semibold text-white transition duration-300 hover:-translate-y-0.5 hover:bg-white/15"
                    >
                      Need sales help instead?
                    </Link>
                  </div>
                </form>
              </AdaptiveSurface>
            </div>
          </div>
        </section>
      </PublicPageTransition>

      <Footer />
      <LandingPageChatBubble />
    </div>
  );
}
