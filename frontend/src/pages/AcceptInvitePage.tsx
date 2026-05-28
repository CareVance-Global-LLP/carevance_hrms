import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import BrandLogo from '@/components/branding/BrandLogo';
import AuthPageFooter from '@/components/auth/AuthPageFooter';
import StatusBadge from '@/components/ui/StatusBadge';
import { invitationApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { analytics } from '@/lib/analytics';

const parseError = (error: any) => {
  const fieldErrors = error?.response?.data?.errors;
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors).flat().find(Boolean)
    : null;
  const normalizedFieldError = typeof firstFieldError === 'string' ? firstFieldError : '';

  const responseMessage = String(error?.response?.data?.message || '');

  if (
    responseMessage.includes('No query results for model [App\\Models\\Invitation]')
    || responseMessage.includes('This invitation is no longer available.')
  ) {
    return 'This invitation is no longer available.';
  }

  return normalizedFieldError || responseMessage || 'Unable to accept this invitation right now.';
};

export default function AcceptInvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { acceptInvitation } = useAuth();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const invitationQuery = useQuery({
    queryKey: ['accept-invitation', token],
    queryFn: async () => {
      const response = await invitationApi.getByToken(token);
      return response.data.invitation;
    },
    enabled: token.length > 0,
    retry: false,
  });

  const invitation = invitationQuery.data;
  const topError = useMemo(
    () => submitError || (invitationQuery.error ? parseError(invitationQuery.error) : ''),
    [invitationQuery.error, submitError]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError('');

    if (password !== passwordConfirmation) {
      setSubmitError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      analytics.trackEvent('invite_accept_started', {
        source: 'accept-invite-page',
      });
      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await acceptInvitation(token, {
        name: name.trim(),
        password,
        password_confirmation: passwordConfirmation,
        timezone: browserTimezone,
      });

      analytics.trackEvent('invite_accept_completed', {
        source: 'accept-invite-page',
      });
      navigate(`/verify-email?email=${encodeURIComponent(result.email)}&status=pending-invite`);
    } catch (requestError: any) {
      setSubmitError(parseError(requestError));
    } finally {
      setIsSubmitting(false);
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
                  Accept your invitation
                </h1>
                <p className="mt-4 text-base leading-8 text-slate-600">
                  Create your password to join the invited workspace. Your email and assigned role are securely locked by the invitation itself.
                </p>
              </div>

              {topError ? (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <p className="text-sm text-red-700">{topError}</p>
                </div>
              ) : null}

              {!invitationQuery.isLoading && (!invitation || invitation.can_accept === false) ? (
                <div className="rounded-[28px] border border-slate-200/80 bg-slate-50/85 p-5">
                  <p className="text-sm font-semibold text-slate-950">This invite cannot be accepted.</p>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    It may have expired, already been used, or been revoked by your workspace admin.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      to="/login"
                      className="inline-flex items-center justify-center rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-3 text-sm font-semibold text-white"
                    >
                      Go to login
                    </Link>
                    <Link
                      to="/contact-sales"
                      className="inline-flex items-center justify-center rounded-full border border-slate-300/85 bg-white px-5 py-3 text-sm font-semibold text-slate-800"
                    >
                      Need help?
                    </Link>
                  </div>
                </div>
              ) : (
                <form className="space-y-5" onSubmit={handleSubmit}>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-800">Invited Email</label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        readOnly
                        value={invitation?.email || ''}
                        className="block w-full rounded-[22px] border border-slate-200/90 bg-slate-50 py-4 pl-12 pr-4 text-sm text-slate-500 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-[22px] border border-slate-200/90 bg-slate-50/85 px-4 py-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">Assigned role</p>
                      <p className="mt-1 text-sm text-slate-500">{invitation?.organization?.name}</p>
                    </div>
                    <StatusBadge tone="info">{invitation?.role || 'Role'}</StatusBadge>
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
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 px-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
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
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 px-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                      placeholder="********"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || invitationQuery.isLoading || !invitation?.can_accept}
                    className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-4 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_58px_-20px_rgba(14,165,233,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Joining workspace...
                      </>
                    ) : (
                      <>
                        Create account
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </button>
                </form>
              )}

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
                  Invitations keep the workspace secure while onboarding stays smooth.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-[1.08rem]">
                  CareVance locks the invited email and role server-side, validates the token, and marks the invite as accepted as soon as your account is created.
                </p>

                <ul className="mt-9 grid gap-4 sm:grid-cols-2">
                  <li className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                    <ShieldCheck className="mb-3 h-5 w-5 text-sky-700" />
                    <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Role locked</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">The backend enforces the assigned role from the invitation record only.</p>
                  </li>
                  <li className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                    <Mail className="mb-3 h-5 w-5 text-sky-700" />
                    <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Email locked</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">The invited email is prefilled and cannot be edited on the accept screen.</p>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
