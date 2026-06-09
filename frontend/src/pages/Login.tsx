import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isLikelyMobile } from '@/lib/mobile';
import { authApi } from '@/services/api';
import {
  AlertCircle,
  ArrowLeft,
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
import BrandLogo from '@/components/branding/BrandLogo';
import AuthPageFooter from '@/components/auth/AuthPageFooter';
import { desktopDownloadUrl } from '@/lib/runtimeConfig';
import { analytics } from '@/lib/analytics';
import GoogleLoginButton from '@/components/auth/GoogleLoginButton';

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
  const [error, setError] = useState<React.ReactNode>('');
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
      // First check if email exists in database
      const checkResponse = await authApi.checkEmail(submittedEmail);
      const emailExists = checkResponse.data.exists;
      
      // If email doesn't exist, redirect to signup with pre-filled email
      if (!emailExists) {
        navigate(`/signup-owner?email=${encodeURIComponent(submittedEmail)}`);
        return;
      }

      analytics.trackEvent('login_submitted', {
        source: 'login-page',
      });
      await login(submittedEmail, submittedPassword, { remember: shouldRemember });
      if (shouldRemember) {
        window.localStorage.setItem(REMEMBERED_EMAIL_KEY, submittedEmail);
      } else {
        window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }
      navigate(isLikelyMobile() ? '/mobile/dashboard' : '/dashboard');
    } catch (err: any) {
      const errorCode = err.response?.data?.error_code;
      const responseEmail = err.response?.data?.email || submittedEmail;
      const status = err.response?.status;

      if (errorCode === 'EMAIL_NOT_VERIFIED') {
        navigate(`/verify-email?email=${encodeURIComponent(responseEmail)}&status=pending-login`);
        return;
      }

      if (errorCode === 'NO_ORGANIZATION') {
        setError(
          <>
            You don't have an active workspace.{' '}
            <Link to="/signup-owner" className="font-semibold text-sky-700 underline">
              Sign up for a free trial
            </Link>{' '}
            to get started.
          </>
        );
        return;
      }

      if (status === 500) {
        setError('The server hit an unexpected error. Please try again in a moment or contact support if it persists.');
        return;
      }

      if (status === 429 || errorCode === 'TOO_MANY_REQUESTS') {
        setError('Too many login attempts. Please wait a minute and try again.');
        return;
      }

      if (status && status >= 500) {
        setError('The server is temporarily unavailable. Please try again shortly.');
        return;
      }

      const serverMessage = err.response?.data?.message;
      if (serverMessage && serverMessage !== 'The given data was invalid.') {
        setError(serverMessage);
        return;
      }

      const fieldError = err.response?.data?.errors?.email?.[0] || err.response?.data?.errors?.password?.[0];
      setError(fieldError || 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  const isDesktopShell = typeof window !== 'undefined' && Boolean((window as any).desktopTracker);

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-slate-900">
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.15) 1px, transparent 0)', backgroundSize: '32px 32px' }} />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1400px] flex-col lg:flex-row">
        {/* Left: Login form */}
        <section className="order-1 flex w-full items-center justify-center px-4 py-12 sm:px-6 lg:w-[45%] lg:px-12">
          <div className="w-full max-w-md">
            {!isDesktopShell && (
              <Link
                to="/"
                className="mb-8 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition duration-200 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                aria-label="Back to home"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            )}
            <div className="mb-8">
              <BrandLogo variant="full" size="sm" className="mb-6 block max-w-[14rem]" />
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Sign in to CareVance
              </h1>
              <p className="mt-3 text-[15px] leading-7 text-slate-500">
                Welcome back. Open the dashboard, monitoring, attendance, reporting, payroll, and internal operations modules from one place.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                New here?{' '}
                <Link
                  to="/signup-owner"
                  className="font-semibold text-blue-600 transition hover:text-blue-700"
                >
                  Start your workspace
                </Link>
              </p>
            </div>

            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <div className="text-sm text-red-700">{error}</div>
              </div>
            )}

            <div className="mb-5">
              <GoogleLoginButton type="login" />
            </div>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-sm text-slate-400">Or sign in with email</span>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 transition duration-200 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Password
                </label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-11 text-sm text-slate-900 placeholder-slate-400 transition duration-200 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition hover:text-slate-600"
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
                    className="h-4 w-4 rounded border-slate-300 bg-white text-blue-600 focus:ring-blue-500"
                  />
                  Remember me
                </label>
                <Link
                  to="/forgot-password"
                  className="text-sm font-medium text-blue-600 transition hover:text-blue-700"
                >
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-blue-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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

            {desktopDownloadUrl && !isDesktopShell ? (
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 transition-all duration-200 hover:border-slate-300 hover:shadow-md">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
                    <Monitor className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Desktop Tracker</p>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900">Windows app for screenshots, idle detection, and sync</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Use screenshot capture, idle detection, and timer sync from the Windows desktop app.
                    </p>
                    <a
                      href={desktopDownloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <Download className="h-3 w-3" />
                      Download for Windows
                    </a>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-8 border-t border-slate-100 pt-5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
                <Link to="/privacy" className="transition hover:text-slate-600">
                  Privacy Policy
                </Link>
                <Link to="/terms" className="transition hover:text-slate-600">
                  Terms & Conditions
                </Link>
                <Link to="/support" className="transition hover:text-slate-600">
                  Support
                </Link>
                <button
                  type="button"
                  onClick={() => {}}
                  className="transition hover:text-slate-600"
                >
                  Cookie Preferences
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Right: Feature showcase */}
        <section className="order-2 hidden w-full lg:flex lg:w-[55%] lg:items-center lg:justify-center lg:px-12 lg:py-12">
          <div className="w-full max-w-xl">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight text-slate-900 lg:text-5xl">
              Access the real CareVance HRMS workflows after sign in.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-500">
              This login takes you into the same modules shown on the front page: employee monitoring, attendance, reports, payroll, invoices, projects, tasks, chat, and settings.
            </p>

            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              <li className="rounded-lg border border-slate-200 bg-white p-5 transition-all duration-200 hover:border-slate-300 hover:shadow-md">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Clock className="h-4 w-4" />
                </div>
                <p className="text-sm font-semibold text-slate-900">Dashboard + Attendance</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Primary timer, today&apos;s entries, punch in or out, and shift tracking.</p>
              </li>
              <li className="rounded-lg border border-slate-200 bg-white p-5 transition-all duration-200 hover:border-slate-300 hover:shadow-md">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <BarChart3 className="h-4 w-4" />
                </div>
                <p className="text-sm font-semibold text-slate-900">Monitoring + Reports</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Review productive vs unproductive activity, screenshots, rankings, and exports.</p>
              </li>
              <li className="rounded-lg border border-slate-200 bg-white p-5 transition-all duration-200 hover:border-slate-300 hover:shadow-md">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <p className="text-sm font-semibold text-slate-900">Payroll + Invoices</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Generate payroll records, track payouts, issue payslips, and manage invoices.</p>
              </li>
              <li className="rounded-lg border border-slate-200 bg-white p-5 transition-all duration-200 hover:border-slate-300 hover:shadow-md">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <p className="text-sm font-semibold text-slate-900">Admin Workflows</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Manage users, report groups, leave approvals, time edits, notifications, and chat.</p>
              </li>
            </ul>

            {desktopDownloadUrl && !isDesktopShell ? (
              <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 transition-all duration-200 hover:border-slate-300 hover:shadow-md">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600">Desktop Tracker</p>
                    <p className="mt-1.5 text-sm font-semibold text-slate-900">Windows companion for live monitoring inputs</p>
                  </div>
                  <a
                    href={desktopDownloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <Download className="h-3 w-3" />
                    Download for Windows
                  </a>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="col-span-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 p-4">
                    <div className="mb-2 h-1.5 w-28 rounded-full bg-white/25" />
                    <div className="mb-3 h-1.5 w-16 rounded-full bg-white/15" />
                    <div className="h-20 rounded-lg bg-gradient-to-br from-cyan-500/20 via-blue-500/15 to-white/5" />
                  </div>
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-900 p-4">
                    <div className="mb-2 h-1.5 w-full rounded-full bg-white/25" />
                    <div className="mb-3 h-1.5 w-2/3 rounded-full bg-white/15" />
                    <div className="h-12 rounded-lg bg-white/10" />
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  Use the Windows app when you need screenshot capture, idle detection, active-window tracking, and timer sync with the web dashboard.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
