import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isLikelyMobile } from '@/lib/mobile';
import { authApi } from '@/services/api';
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
import AuthPageShell, {
  authIconClass,
  authLabelClass,
  authPrimaryButtonClass,
  type AuthShowcaseFeature,
} from '@/components/auth/AuthPageShell';
import { desktopDownloadUrl } from '@/lib/runtimeConfig';
import { analytics } from '@/lib/analytics';
import GoogleLoginButton from '@/components/auth/GoogleLoginButton';
import OneTimeCodeInput from '@/components/auth/OneTimeCodeInput';
import { brandLabel, productLabel } from '@/config/brand';

const REMEMBERED_EMAIL_KEY = 'carevance.rememberedEmail';

/**
 * This page is the reference the other signed-out pages match, so its chrome
 * lives in AuthPageShell rather than here — restyling one page now restyles
 * the set.
 */
const FEATURES: AuthShowcaseFeature[] = [
  {
    icon: Clock,
    title: 'Dashboard + Attendance',
    description: "Primary timer, today's entries, punch in or out, and shift tracking.",
  },
  {
    icon: BarChart3,
    title: 'Monitoring + Reports',
    description: 'Review productive vs unproductive activity, screenshots, rankings, and exports.',
  },
  {
    icon: ShieldCheck,
    title: 'Payroll + Invoices',
    description: 'Generate payroll records, track payouts, issue payslips, and manage invoices.',
  },
  {
    icon: CheckCircle2,
    title: 'Admin Workflows',
    description: 'Manage users, report groups, leave approvals, time edits, notifications, and chat.',
  },
];

export default function Login() {
  const getRememberedEmail = () => {
    if (typeof window === 'undefined') {
      return '';
    }

    return window.localStorage.getItem(REMEMBERED_EMAIL_KEY) || '';
  };

  /*
   * A joiner arriving straight from accepting an invitation.
   *
   * Their account already exists and is verified, so the only thing left is to
   * sign in — prefill the address they just confirmed and say so, rather than
   * dropping them on an empty form with no explanation of what just happened.
   */
  const [searchParams] = useSearchParams();
  const invitedEmail = searchParams.get('status') === 'invite-accepted'
    ? (searchParams.get('email') || '')
    : '';

  const [email, setEmail] = useState(() => invitedEmail || getRememberedEmail());
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => getRememberedEmail() !== '');
  const [error, setError] = useState<React.ReactNode>('');
  const [isLoading, setIsLoading] = useState(false);

  /**
   * A half-finished sign-in. Non-null means the password was accepted and the
   * page is waiting for a second factor. It is an opaque handle — it says
   * nothing about whose account it belongs to.
   */
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const { login, completeMfaChallenge } = useAuth();
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
      const result = await login(submittedEmail, submittedPassword, { remember: shouldRemember });

      if (shouldRemember) {
        window.localStorage.setItem(REMEMBERED_EMAIL_KEY, submittedEmail);
      } else {
        window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }

      /*
       * The password was right, but this account has an authenticator, so no
       * session exists yet. Hand over to the code step rather than navigating
       * — before this branch existed, anyone who enrolled in two-factor could
       * never sign in again.
       */
      if (result?.mfaRequired) {
        setMfaChallenge(result.challenge);
        setMfaCode('');
        setError(null);
        return;
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

  const handleMfaSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!mfaChallenge || mfaCode.trim().length === 0) {
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      await completeMfaChallenge(mfaChallenge, mfaCode);
      navigate(isLikelyMobile() ? '/mobile/dashboard' : '/dashboard');
    } catch (err: any) {
      const errorCode = err.response?.data?.error_code;

      /*
       * The challenge expired, so there is nothing left to retry against.
       * Send them back to the password form rather than leaving them typing
       * codes into a handle the server has already forgotten.
       */
      if (errorCode === 'MFA_CHALLENGE_EXPIRED') {
        setMfaChallenge(null);
        setMfaCode('');
        setError('That sign-in attempt timed out. Please enter your password again.');
        return;
      }

      setError(err.response?.data?.message || 'That code was not accepted. Check the app and try again.');
      setMfaCode('');
    } finally {
      setIsLoading(false);
    }
  };

  const isDesktopShell = typeof window !== 'undefined' && Boolean((window as any).desktopTracker);

  return (
    <AuthPageShell
      backTo={isDesktopShell ? null : '/'}
      heading={`Sign in to ${brandLabel}`}
      intro="Welcome back. Open the dashboard, monitoring, attendance, reporting, payroll, and internal operations modules from one place."
      introAside={
        <>
          New here?{' '}
          <Link to="/signup-owner" className="font-semibold text-blue-600 transition hover:text-blue-700">
            Start your workspace
          </Link>
        </>
      }
      showcaseHeading={`Access the real ${productLabel} workflows after sign in.`}
      showcaseIntro="This login takes you into the same modules shown on the front page: employee monitoring, attendance, reports, payroll, invoices, projects, tasks, chat, and settings."
      features={FEATURES}
      showcaseBelow={
        desktopDownloadUrl && !isDesktopShell ? (
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
              <div className="col-span-2 overflow-hidden rounded-lg border border-slate-200 surface-fixed-dark p-4">
                <div className="mb-2 h-1.5 w-28 rounded-full bg-white/25" />
                <div className="mb-3 h-1.5 w-16 rounded-full bg-white/15" />
                <div className="h-20 rounded-lg bg-gradient-to-br from-cyan-500/20 via-blue-500/15 to-white/5" />
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200 surface-fixed-dark p-4">
                <div className="mb-2 h-1.5 w-full rounded-full bg-white/25" />
                <div className="mb-3 h-1.5 w-2/3 rounded-full bg-white/15" />
                <div className="h-12 rounded-lg bg-white/10" />
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Use the Windows app when you need screenshot capture, idle detection, active-window tracking, and timer sync with the web dashboard.
            </p>
          </div>
        ) : null
      }
      belowForm={
        desktopDownloadUrl && !isDesktopShell ? (
          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 transition-all duration-200 hover:border-slate-300 hover:shadow-md">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-inverse text-on-inverse">
                <Monitor className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
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
        ) : null
      }
    >
      <>
            {invitedEmail && !error && (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="text-sm text-emerald-800">
                  Your account is ready. Sign in with the password you just set to get started.
                </div>
              </div>
            )}

            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <div className="text-sm text-red-700">{error}</div>
              </div>
            )}

            {mfaChallenge ? (
              /*
               * The second-factor step. Rendered instead of the password form
               * rather than beside it: the password is already accepted, and
               * showing both invites people to retype it and start over.
               */
              <form className="space-y-4" onSubmit={handleMfaSubmit}>
                <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <div className="text-sm text-sky-900">
                    <p className="font-semibold">Two-factor authentication</p>
                    <p className="mt-0.5 text-sky-800">
                      {useRecoveryCode
                        ? 'Enter one of the recovery codes you saved when you set this up. Each one works once.'
                        : 'Enter the 6-digit code from your authenticator app.'}
                    </p>
                  </div>
                </div>

                <div>
                  <label htmlFor="one-time-code" className={authLabelClass}>
                    {useRecoveryCode ? 'Recovery code' : 'Authentication code'}
                  </label>
                  <OneTimeCodeInput
                    value={mfaCode}
                    onChange={setMfaCode}
                    allowRecoveryCode={useRecoveryCode}
                    autoFocus
                    disabled={isLoading}
                    placeholder={useRecoveryCode ? 'XXXXX-XXXXX' : '123456'}
                    aria-describedby="one-time-code-hint"
                    aria-invalid={Boolean(error)}
                  />
                  <p id="one-time-code-hint" className="mt-2 text-xs text-slate-500">
                    {useRecoveryCode
                      ? 'Using a recovery code will use it up. Generate a new set afterwards from Settings.'
                      : 'The code changes every 30 seconds. If it is rejected, wait for the next one.'}
                  </p>
                </div>

                <button
                  type="submit"
                  className={authPrimaryButtonClass}
                  disabled={isLoading || mfaCode.trim().length === 0}
                >
                  {isLoading ? 'Verifying…' : 'Verify and sign in'}
                  {!isLoading && <ArrowRight className="h-4 w-4" />}
                </button>

                <div className="flex flex-col gap-2 text-center text-sm">
                  <button
                    type="button"
                    className="font-semibold text-sky-700 underline-offset-2 hover:underline"
                    onClick={() => {
                      setUseRecoveryCode((previous) => !previous);
                      setMfaCode('');
                      setError('');
                    }}
                  >
                    {useRecoveryCode
                      ? 'Use my authenticator app instead'
                      : "I can't reach my authenticator app"}
                  </button>
                  <button
                    type="button"
                    className="text-slate-500 underline-offset-2 hover:underline"
                    onClick={() => {
                      setMfaChallenge(null);
                      setMfaCode('');
                      setUseRecoveryCode(false);
                      setError('');
                    }}
                  >
                    Back to sign in
                  </button>
                </div>
              </form>
            ) : (
              <>
            <div className="mb-5">
              <GoogleLoginButton type="login" />
            </div>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-sm text-slate-500">Or sign in with email</span>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email" className={authLabelClass}>
                  Email Address
                </label>
                <div className="relative">
                  <Mail className={authIconClass} />
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
                <label htmlFor="password" className={authLabelClass}>
                  Password
                </label>
                <div className="relative">
                  <LockKeyhole className={authIconClass} />
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
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 transition hover:text-slate-600"
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

              <button type="submit" disabled={isLoading} className={authPrimaryButtonClass}>
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
              </>
            )}
      </>
    </AuthPageShell>
  );
}
