import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import BrandLogo from '@/components/branding/BrandLogo';
import AuthPageFooter from '@/components/auth/AuthPageFooter';
import StatusBadge from '@/components/ui/StatusBadge';
import { inviteApi } from '@/services/api';
import type { InviteValidationResponse } from '@/types';
import { analytics } from '@/lib/analytics';

const parseError = (error: any) => {
  const fieldErrors = error?.response?.data?.errors;
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors).flat().find(Boolean)
    : null;

  return typeof firstFieldError === 'string'
    ? firstFieldError
    : String(error?.response?.data?.message || 'Unable to accept this invitation right now.');
};

export default function InviteSignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const [isLoading, setIsLoading] = useState(true);
  const [invite, setInvite] = useState<InviteValidationResponse | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    const validate = async () => {
      if (!token) {
        setError('Invite token is missing.');
        setIsLoading(false);
        return;
      }

      try {
        const response = await inviteApi.validate(token);
        if (!mounted) return;

        if (response.data.valid) {
          setInvite(response.data);
          setError('');
        } else {
          setError(response.data.message || 'This invite is not valid.');
        }
      } catch (requestError: any) {
        if (!mounted) return;
        setError(requestError?.response?.data?.message || 'Unable to validate this invite.');
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void validate();

    return () => {
      mounted = false;
    };
  }, [token]);

  const topError = useMemo(() => error, [error]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (password !== passwordConfirmation) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      analytics.trackEvent('invite_accept_started', {
        source: 'invite-signup-page',
      });

      const response = await inviteApi.accept({
        token,
        name: name.trim(),
        password,
        password_confirmation: passwordConfirmation,
      });

      analytics.trackEvent('invite_accept_completed', {
        source: 'invite-signup-page',
      });

      const email = response.data.email || invite?.email || '';
      navigate(`/verify-email?email=${encodeURIComponent(email)}&status=pending-invite`);
    } catch (requestError: any) {
      setError(parseError(requestError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#fcfdff_0%,#f2f8ff_26%,#eef5ff_56%,#f8fafc_100%)] text-slate-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.32),transparent_58%)]" />
      <div className="pointer-events-none absolute -left-16 top-28 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="pointer-events-none absolute right-[-6rem] top-40 h-[28rem] w-[28rem] rounded-full bg-cyan-200/25 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1200px] items-center px-4 py-10 sm:px-6 lg:px-10">
        <div className="w-full max-w-xl animate-fade-in">
          <AdaptiveSurface
            className="glass-panel premium-ring rounded-[34px] p-6 shadow-[0_40px_120px_-56px_rgba(15,23,42,0.45)] sm:p-8"
            tone="light"
            backgroundColor="rgba(255,255,255,0.8)"
          >
            <div className="mb-6">
              <div className="mb-6 flex items-center">
                <Link
                  to="/"
                  aria-label="Back to home"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-600 shadow-[0_16px_35px_-24px_rgba(15,23,42,0.25)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-slate-950 hover:text-slate-950"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </div>
              <BrandLogo variant="full" size="sm" className="mb-5 max-w-[16rem]" />
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-[3.1rem] sm:leading-[0.95]">
                Join your workspace
              </h1>
              <p className="mt-4 text-base leading-8 text-slate-600">
                Complete your invite signup by setting your password. Your invited email stays locked to the invitation.
              </p>
            </div>

            {isLoading ? (
              <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/85 px-4 py-4 text-sm text-slate-600">
                Validating invite...
              </div>
            ) : null}

            {!isLoading && topError ? (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <p className="text-sm text-red-700">{topError}</p>
              </div>
            ) : null}

            {!isLoading && invite?.valid ? (
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Invite verified</p>
                    <p className="mt-1 text-sm text-emerald-700">
                      {invite.email} {invite.role ? `(${invite.role})` : ''}
                    </p>
                    {invite.organization?.name ? (
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-emerald-700/80">
                        {invite.organization.name}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-[22px] border border-slate-200/90 bg-slate-50/85 px-4 py-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Assigned role</p>
                    <p className="mt-1 text-sm text-slate-500">{invite.organization?.name || 'Invited workspace'}</p>
                  </div>
                  <StatusBadge tone="info">{invite.role || 'Employee'}</StatusBadge>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-800">Invited Email</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      readOnly
                      value={invite.email || ''}
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-slate-50 py-4 pl-12 pr-4 text-sm text-slate-500 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="name" className="mb-2 block text-sm font-semibold text-slate-800">
                    Full Name
                  </label>
                  <input
                    id="name"
                    type="text"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 px-4 py-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                    placeholder="Your full name"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-800">
                    Password
                  </label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 pl-12 pr-12 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                      placeholder="********"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 transition hover:text-slate-700"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="password-confirmation" className="mb-2 block text-sm font-semibold text-slate-800">
                    Confirm Password
                  </label>
                  <input
                    id="password-confirmation"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={passwordConfirmation}
                    onChange={(event) => setPasswordConfirmation(event.target.value)}
                    className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 px-4 py-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                    placeholder="********"
                  />
                </div>

                <div className="rounded-[22px] border border-sky-100 bg-sky-50/80 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
                    <p className="text-sm leading-7 text-sky-900">
                      After creating your account, we’ll send an email verification link before first sign-in.
                    </p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-4 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_58px_-20px_rgba(14,165,233,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Creating account...
                    </>
                  ) : (
                    <>
                      Create account
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>
            ) : null}

            {!isLoading && !invite?.valid && !topError ? (
              <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/85 px-4 py-4 text-sm text-slate-600">
                This invite is not available anymore.
              </div>
            ) : null}

            <AuthPageFooter />
          </AdaptiveSurface>
        </div>
      </div>
    </main>
  );
}
