import { useState } from 'react';
import { AlertCircle, ArrowRight, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import AuthPageShell, {
  authIconClass,
  authInputWithIconClass,
  authLabelClass,
  authPrimaryButtonClass,
  type AuthShowcaseFeature,
} from '@/components/auth/AuthPageShell';
import { authApi } from '@/services/api';

const FEATURES: AuthShowcaseFeature[] = [
  {
    icon: ShieldCheck,
    title: 'Always the same answer',
    description: 'The response never reveals whether an account exists, so the form cannot be used to probe for addresses.',
  },
  {
    icon: KeyRound,
    title: 'Single use, time limited',
    description: 'The reset link works once and expires, and using it signs out other sessions.',
  },
];

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setIsSubmitting(true);

    try {
      const response = await authApi.forgotPassword({ email: email.trim() });
      setSuccess(response.data.message || 'If an account exists for that email, a reset link has been sent.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Unable to send a reset link right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthPageShell
      backTo="/login"
      backLabel="Back to sign in"
      heading="Reset your password"
      intro="Enter your account email and we'll send a password reset link if the account is available."
      showcaseHeading="Password recovery stays outside the core workspace flow."
      showcaseIntro="Reset links are handled separately so sign-in, invite acceptance, payroll, and dashboard routes keep their existing behavior."
      features={FEATURES}
    >
      {error ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      ) : null}

      {success ? (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email" className={authLabelClass}>
            Email Address
          </label>
          <div className="relative">
            <Mail className={authIconClass} />
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={authInputWithIconClass}
              placeholder="you@example.com"
            />
          </div>
        </div>

        <button type="submit" disabled={isSubmitting} className={authPrimaryButtonClass}>
          {isSubmitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Sending reset link...
            </>
          ) : (
            <>
              Send reset link
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>
    </AuthPageShell>
  );
}
