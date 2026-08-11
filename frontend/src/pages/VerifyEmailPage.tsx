import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import BrandLogo from '@/components/branding/BrandLogo';
import AuthPageFooter from '@/components/auth/AuthPageFooter';
import { useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/services/api';

export default function VerifyEmailPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [infoMessage, setInfoMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const status = searchParams.get('status');
  const email = searchParams.get('email')?.trim() || user?.email || '';
  const [verificationResolved, setVerificationResolved] = useState(
    status === 'verified' || status === 'already-verified' || Boolean(user?.email_verified_at)
  );

  const statusMessage = useMemo(() => {
    if (status === 'verified') {
      return { tone: 'success' as const, message: 'Your email has been verified successfully.' };
    }

    if (status === 'already-verified') {
      return { tone: 'success' as const, message: 'This email was already verified.' };
    }

    if (status === 'expired' || status === 'invalid') {
      return { tone: 'error' as const, message: 'This verification link is invalid or has expired.' };
    }

    if (status === 'pending-signup') {
      return {
        tone: 'success' as const,
        message: 'Your account was created. Please verify your email before signing in.',
      };
    }

    if (status === 'pending-invite') {
      return {
        tone: 'success' as const,
        message: 'Your invited account is ready. Please verify your email before signing in.',
      };
    }

    if (status === 'pending-login') {
      return {
        tone: 'error' as const,
        message: 'Please verify your email before signing in.',
      };
    }

    return null;
  }, [status]);

  const isVerified = verificationResolved || Boolean(user?.email_verified_at);

  const handleResend = async () => {
    setInfoMessage('');
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const response = user
        ? await authApi.resendVerificationEmail()
        : await authApi.requestVerificationEmail({ email });
      setInfoMessage(response.data.message || 'A new verification email has been sent.');
      if (response.data.already_verified) {
        setVerificationResolved(true);
      }
    } catch (requestError: any) {
      setErrorMessage(requestError?.response?.data?.message || 'Unable to resend the verification email right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden page-canvas text-slate-950">
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
                <div className="mb-6 flex items-center">
                  <Link
                    to={user ? '/dashboard' : '/login'}
                    aria-label="Back"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-600 shadow-[0_16px_35px_-24px_rgba(15,23,42,0.25)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-slate-950 hover:text-slate-950"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Link>
                </div>
                <BrandLogo variant="full" size="sm" className="mb-5 max-w-[16rem]" />
                <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-[3.1rem] sm:leading-[0.95]">
                  Verify your email
                </h1>
                <p className="mt-4 text-base leading-8 text-slate-600">
                  New workspace signups and invited accounts can confirm email ownership here before continuing into the platform.
                </p>
              </div>

              {statusMessage?.tone === 'success' ? (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <p className="text-sm text-emerald-700">{statusMessage.message}</p>
                </div>
              ) : null}

              {statusMessage?.tone === 'error' ? (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <p className="text-sm text-red-700">{statusMessage.message}</p>
                </div>
              ) : null}

              {infoMessage ? (
                <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4 text-sm text-emerald-700">
                  {infoMessage}
                </div>
              ) : null}

              {errorMessage ? (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <p className="text-sm text-red-700">{errorMessage}</p>
                </div>
              ) : null}

              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/85 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-sky-100 text-sky-700">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-950">Verification status</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {isVerified ? 'Verified' : 'Pending verification'}
                      </p>
                      {email ? <p className="mt-1 text-sm text-slate-500">{email}</p> : null}
                    </div>
                  </div>
                </div>

                {email && !isVerified ? (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isSubmitting}
                    className="inline-flex w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-4 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_58px_-20px_rgba(14,165,233,0.7)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? 'Sending verification email...' : 'Resend verification email'}
                  </button>
                ) : null}

                <Link
                  to={isVerified && user ? '/dashboard' : '/login'}
                  className="inline-flex w-full items-center justify-center rounded-full border border-slate-300/85 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition duration-300 hover:-translate-y-0.5 hover:border-slate-950"
                >
                  {isVerified && user ? 'Back to dashboard' : 'Go to login'}
                </Link>
              </div>

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
                  Verification starts at account creation, not at every login.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-[1.08rem]">
                  Use this page right after a new account is created to resend the email, confirm the address, and finish setup without changing the normal sign-in flow for returning users.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
