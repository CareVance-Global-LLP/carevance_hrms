import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import AuthPageShell, {
  authIconClass,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
  type AuthShowcaseFeature,
} from '@/components/auth/AuthPageShell';
import StatusBadge from '@/components/ui/StatusBadge';
import { invitationApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { analytics } from '@/lib/analytics';
import { detectTimeZone } from '@/lib/timezones';
import { roleLabel } from '@/utils/roleLabel';
import PasswordStrength, { evaluatePassword } from '@/features/settings/components/PasswordStrength';

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

const FEATURES: AuthShowcaseFeature[] = [
  {
    icon: ShieldCheck,
    title: 'Role locked',
    description: 'The backend enforces the assigned role from the invitation record only.',
  },
  {
    icon: Mail,
    title: 'Email locked',
    description: 'The invited address is prefilled and cannot be edited on this screen.',
  },
  {
    icon: Clock,
    title: 'Single use, time limited',
    description: 'Only a hash of the link is stored, so it works once and expires on schedule.',
  },
  {
    icon: CheckCircle2,
    title: 'Straight to sign in',
    description: 'Create your account and you land on the CareVance sign-in page, ready to go.',
  },
];

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

  const organizationName = invitation?.organization?.name || 'your workspace';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError('');

    if (password !== passwordConfirmation) {
      setSubmitError('Passwords do not match.');
      return;
    }

    /*
     * Stop here rather than posting something the server will certainly refuse.
     * This page used to send whatever was typed and let the joiner discover the
     * policy from the response — which is how somebody setting their very first
     * password learned the rules only by failing.
     */
    if (evaluatePassword(password).score < 4) {
      setSubmitError('Your password does not meet the requirements listed below the field.');
      return;
    }

    setIsSubmitting(true);

    try {
      analytics.trackEvent('invite_accept_started', {
        source: 'accept-invite-page',
      });
      // Canonicalised: Chrome reports IST as the legacy `Asia/Calcutta`, which
      // was being stamped onto the new account's settings and then matched no
      // option in any timezone picker in the app.
      const result = await acceptInvitation(token, {
        name: name.trim(),
        password,
        password_confirmation: passwordConfirmation,
        timezone: detectTimeZone(),
      });

      analytics.trackEvent('invite_accept_completed', {
        source: 'accept-invite-page',
      });

      /*
       * Only send them to verify if the server actually wants verification.
       *
       * This redirect used to be unconditional, so an invited joiner was told
       * "please verify your email before signing in" immediately after proving
       * they control that mailbox by redeeming a token sent to it. The account
       * is created verified now, and the response says so — this reads it
       * instead of assuming.
       */
      if (result.requiresVerification) {
        navigate(`/verify-email?email=${encodeURIComponent(result.email)}&status=pending-invite`);
        return;
      }

      navigate(`/login?email=${encodeURIComponent(result.email)}&status=invite-accepted`);
    } catch (requestError: any) {
      setSubmitError(parseError(requestError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthPageShell
      heading="Accept your invitation"
      intro={`Set a password to join ${organizationName} on CareVance. Your email address and assigned role come from the invitation and cannot be changed here.`}
      introAside={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-blue-600 transition hover:text-blue-700">
            Sign in instead
          </Link>
        </>
      }
      showcaseHeading="Invitations keep the workspace secure while onboarding stays smooth."
      showcaseIntro="CareVance locks the invited email and role server-side, validates the token, and marks the invite as accepted the moment your account is created."
      features={FEATURES}
    >
      {topError ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div className="text-sm text-red-700">{topError}</div>
        </div>
      ) : null}

      {!invitationQuery.isLoading && (!invitation || invitation.can_accept === false) ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <p className="text-sm font-semibold text-slate-900">This invite cannot be accepted.</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            It may have expired, already been used, or been revoked by your workspace admin.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-blue-700"
            >
              Go to sign in
            </Link>
            <Link
              to="/contact-sales"
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Need help?
            </Link>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="invited-email" className={authLabelClass}>
              Invited Email
            </label>
            <div className="relative">
              <Mail className={authIconClass} />
              <input
                id="invited-email"
                type="email"
                readOnly
                value={invitation?.email || ''}
                className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-500 outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Assigned role</p>
              <p className="mt-0.5 truncate text-sm text-slate-500">{invitation?.organization?.name}</p>
            </div>
            <StatusBadge tone="info">{invitation?.role ? roleLabel(invitation.role) : 'Role'}</StatusBadge>
          </div>

          <div>
            <label htmlFor="name" className={authLabelClass}>
              Full Name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={authInputClass}
              placeholder="Your full name"
            />
          </div>

          <div>
            <label htmlFor="password" className={authLabelClass}>
              Password
            </label>
            <div className="relative">
              <LockKeyhole className={authIconClass} />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-11 text-sm text-slate-900 placeholder-slate-400 transition duration-200 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                placeholder="Create a password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 transition hover:text-slate-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {/*
              The rules, stated before they are enforced. This box previously
              carried no hint at all, so a joiner's first act in the product was
              being refused for a reason nobody had told them.
            */}
            <PasswordStrength value={password} />
          </div>

          <div>
            <label htmlFor="password-confirmation" className={authLabelClass}>
              Confirm Password
            </label>
            <input
              id="password-confirmation"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              className={authInputClass}
              placeholder="Re-enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || invitationQuery.isLoading || !invitation?.can_accept}
            className={authPrimaryButtonClass}
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
    </AuthPageShell>
  );
}
