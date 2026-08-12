import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { AlertCircle, CheckCircle2, Mail, ShieldCheck } from 'lucide-react';
import AuthPageShell, {
  authPrimaryButtonClass,
  type AuthShowcaseFeature,
} from '@/components/auth/AuthPageShell';
import { useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/services/api';

const FEATURES: AuthShowcaseFeature[] = [
  {
    icon: Mail,
    title: 'Resend on demand',
    description: 'If the first email never arrived, send another without starting the signup over.',
  },
  {
    icon: ShieldCheck,
    title: 'Once, not every login',
    description: 'Verification happens at account creation. Returning users sign in normally.',
  },
];

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
    <AuthPageShell
      backTo={user ? '/dashboard' : '/login'}
      backLabel={user ? 'Back to dashboard' : 'Back to sign in'}
      heading="Verify your email"
      intro="New workspace signups and invited accounts confirm email ownership here before continuing into the platform."
      showcaseHeading="Verification starts at account creation, not at every login."
      showcaseIntro="Use this page right after a new account is created to resend the email, confirm the address, and finish setup — the normal sign-in flow for returning users is untouched."
      features={FEATURES}
    >
      {statusMessage?.tone === 'success' ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <p className="text-sm text-emerald-800">{statusMessage.message}</p>
        </div>
      ) : null}

      {statusMessage?.tone === 'error' ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{statusMessage.message}</p>
        </div>
      ) : null}

      {infoMessage ? (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {infoMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{errorMessage}</p>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Verification status</p>
              <p className="mt-0.5 text-sm text-slate-500">
                {isVerified ? 'Verified' : 'Pending verification'}
              </p>
              {email ? <p className="mt-0.5 truncate text-sm text-slate-500">{email}</p> : null}
            </div>
          </div>
        </div>

        {email && !isVerified ? (
          <button
            type="button"
            onClick={handleResend}
            disabled={isSubmitting}
            className={authPrimaryButtonClass}
          >
            {isSubmitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Sending verification email...
              </>
            ) : (
              'Resend verification email'
            )}
          </button>
        ) : null}

        <Link
          to={isVerified && user ? '/dashboard' : '/login'}
          className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition duration-200 hover:border-slate-300 hover:bg-slate-50"
        >
          {isVerified && user ? 'Back to dashboard' : 'Go to sign in'}
        </Link>
      </div>
    </AuthPageShell>
  );
}
