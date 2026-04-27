import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Monitor,
  ShieldCheck,
} from 'lucide-react';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import BrandLogo from '@/components/branding/BrandLogo';
import AuthPageFooter from '@/components/auth/AuthPageFooter';
import { desktopDownloadLabel, desktopDownloadUrl } from '@/lib/runtimeConfig';
import { analytics } from '@/lib/analytics';

const REMEMBERED_EMAIL_KEY = 'carevance.rememberedEmail';

export default function Login() {
  const getRememberedEmail = () => {
    if (typeof window === 'undefined') {
      return '';
    }

    return window.localStorage.getItem(REMEMBERED_EMAIL_KEY) || '';
  };

  const [email, setEmail] = useState(getRememberedEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => getRememberedEmail() !== '');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const form = new FormData(e.currentTarget as HTMLFormElement);
    const submittedEmail = String(form.get('email') || '').trim();
    const submittedPassword = String(form.get('password') || '');
    const shouldRemember = form.get('remember-me') === 'on';

    setEmail(submittedEmail);
    setPassword(submittedPassword);
    setRememberMe(shouldRemember);
    
    try {
      analytics.trackEvent('login_submitted', {
        source: 'login-page',
      });
      await login(submittedEmail, submittedPassword, { remember: shouldRemember });
      if (shouldRemember) {
        window.localStorage.setItem(REMEMBERED_EMAIL_KEY, submittedEmail);
      } else {
        window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }
      navigate('/dashboard');
    } catch (err: any) {
      const errorCode = err.response?.data?.error_code;
      const responseEmail = err.response?.data?.email || submittedEmail;

      if (errorCode === 'EMAIL_NOT_VERIFIED') {
        navigate(`/verify-email?email=${encodeURIComponent(responseEmail)}&status=pending-login`);
        return;
      }

      setError(err.response?.data?.message || 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#fcfdff_0%,#f2f8ff_26%,#eef5ff_56%,#f8fafc_100%)] text-slate-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.32),transparent_58%)]" />
      <div className="pointer-events-none absolute -left-16 top-28 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="pointer-events-none absolute right-[-6rem] top-40 h-[28rem] w-[28rem] rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="hero-grid pointer-events-none absolute inset-0 opacity-55" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col lg:flex-row">
        <section className="order-1 flex w-full items-center justify-center px-4 py-10 sm:px-6 lg:w-1/2 lg:px-10">
          <div className="w-full max-w-lg animate-fade-in">
            <AdaptiveSurface
              className="glass-panel premium-ring rounded-[34px] p-6 shadow-[0_40px_120px_-56px_rgba(15,23,42,0.45)] sm:p-8"
              tone="light"
              backgroundColor="rgba(255,255,255,0.8)"
            >
              <div className="mb-6">
                <BrandLogo variant="full" size="sm" className="mb-5 max-w-[16rem]" />
                <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-[3.2rem] sm:leading-[0.95]">
                  Sign in to CareVance
                </h1>
                <p className="mt-4 text-base leading-8 text-slate-600">
                  Welcome back. Open the dashboard, monitoring, attendance, reporting, payroll, and internal operations modules from one place.
                </p>
                <p className="mt-3 text-sm text-slate-500">
                  New here?{' '}
                  <Link
                    to="/signup-owner"
                    className="font-semibold text-sky-700 underline-offset-4 transition hover:text-slate-950 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  >
                    Start your workspace
                  </Link>
                </p>
              </div>

              {error && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <form className="space-y-5" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-semibold text-slate-800">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 pl-12 pr-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] transition duration-300 outline-none focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>
          
                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-800">
                    Password
                  </label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 pl-12 pr-12 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] transition duration-300 outline-none focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                      placeholder="********"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 transition hover:text-slate-700 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label htmlFor="remember-me" className="inline-flex items-center gap-2 text-sm text-slate-600">
                    <input
                      id="remember-me"
                      name="remember-me"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 bg-white text-sky-600 focus:ring-sky-400"
                    />
                    Remember me
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-sm font-semibold text-sky-700 transition hover:text-slate-950 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  >
                    Forgot password?
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-4 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_58px_-20px_rgba(14,165,233,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>

              {desktopDownloadUrl ? (
                <div className="mt-7 rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.88))] p-5 shadow-[0_22px_50px_-34px_rgba(15,23,42,0.32)]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-11 w-11 items-center justify-center rounded-[18px] bg-slate-950 text-white shadow-[0_16px_32px_-18px_rgba(15,23,42,0.45)]">
                      <Monitor className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">Desktop Tracker</p>
                      <h3 className="mt-2 text-base font-semibold text-slate-950">Windows app for screenshots, idle detection, and sync</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        Use screenshot capture, idle detection, and timer sync from the Windows desktop app.
                      </p>
                      <a
                        href={desktopDownloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-300/80 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition duration-300 hover:-translate-y-0.5 hover:border-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {desktopDownloadLabel}
                      </a>
                    </div>
                  </div>
                </div>
              ) : null}

              <AuthPageFooter />
            </AdaptiveSurface>
          </div>
        </section>

        <section className="order-2 relative flex w-full overflow-hidden px-4 py-10 sm:px-6 lg:w-1/2 lg:px-10">
          <div className="relative z-10 my-auto w-full">
            <div className="glass-panel premium-ring noise-overlay relative overflow-hidden rounded-[36px] p-6 shadow-[0_50px_140px_-56px_rgba(14,165,233,0.4)] sm:p-8">
              <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.28),transparent_70%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.74),rgba(239,246,255,0.68))]" />
              <div className="relative">
                <h2 className="max-w-2xl text-4xl font-semibold leading-[0.97] tracking-[-0.06em] text-slate-950 sm:text-[3.5rem]">
                  Access the real CareVance HRMS workflows after sign in.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-[1.08rem]">
                  This login takes you into the same modules shown on the front page: employee monitoring, attendance, reports, payroll, invoices, projects, tasks, chat, and settings.
                </p>

                <ul className="mt-9 grid gap-4 sm:grid-cols-2">
                  <li className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                    <Clock className="mb-3 h-5 w-5 text-sky-700" />
                    <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Dashboard + Attendance</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">Primary timer, today&apos;s entries, punch in or out, and shift tracking.</p>
                  </li>
                  <li className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                    <BarChart3 className="mb-3 h-5 w-5 text-sky-700" />
                    <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Monitoring + Reports</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">Review productive vs unproductive activity, screenshots, rankings, and exports.</p>
                  </li>
                  <li className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                    <ShieldCheck className="mb-3 h-5 w-5 text-sky-700" />
                    <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Payroll + Invoices</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">Generate payroll records, track payouts, issue payslips, and manage invoices.</p>
                  </li>
                  <li className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                    <CheckCircle2 className="mb-3 h-5 w-5 text-sky-700" />
                    <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Admin Workflows</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">Manage users, report groups, leave approvals, time edits, notifications, and chat.</p>
                  </li>
                </ul>

                <AdaptiveSurface
                  className="mt-8 rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,#06111f_0%,#020617_100%)] p-5 text-white shadow-[0_36px_90px_-42px_rgba(15,23,42,0.8)]"
                  tone="dark"
                  backgroundColor="#020617"
                >
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="contrast-text-accent text-xs font-semibold uppercase tracking-[0.3em]">Desktop Tracker</p>
                      <p className="contrast-text-primary mt-2 text-lg font-semibold tracking-[-0.04em]">Windows companion for live monitoring inputs</p>
                    </div>
                    <a
                      href={desktopDownloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition duration-300 hover:-translate-y-0.5 hover:bg-white/15"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {desktopDownloadLabel}
                    </a>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 h-2 w-28 rounded-full bg-cyan-200/60" />
                      <div className="mb-3 h-2 w-20 rounded-full bg-white/25" />
                      <div className="h-28 rounded-[20px] bg-[linear-gradient(135deg,rgba(103,232,249,0.24),rgba(59,130,246,0.18),rgba(255,255,255,0.06))]" />
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 h-2 w-full rounded-full bg-white/35" />
                      <div className="mb-3 h-2 w-2/3 rounded-full bg-white/20" />
                      <div className="h-12 rounded-2xl bg-white/15" />
                    </div>
                  </div>
                  <p className="contrast-text-secondary mt-4 max-w-2xl text-sm leading-6">
                    Use the Windows app when you need screenshot capture, idle detection, active-window tracking, and timer sync with the web dashboard.
                  </p>
                </AdaptiveSurface>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
