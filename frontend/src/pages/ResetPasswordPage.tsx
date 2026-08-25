import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import AuthPageShell, {
  authIconClass,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
  type AuthShowcaseFeature,
} from '@/components/auth/AuthPageShell';
import { authApi } from '@/services/api';
import PasswordStrength, { evaluatePassword } from '@/features/settings/components/PasswordStrength';

const FEATURES: AuthShowcaseFeature[] = [
  {
    icon: CheckCircle2,
    title: 'Checked before you type',
    description: 'The link is validated on arrival, so an expired one says so instead of failing on submit.',
  },
  {
    icon: LockKeyhole,
    title: 'Separate from sign in',
    description: 'Resets run outside the normal auth flow, leaving existing session behaviour untouched.',
  },
];

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const email = searchParams.get('email') || '';
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isValidating, setIsValidating] = useState(true);
  const [isTokenValid, setIsTokenValid] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    const validateToken = async () => {
      if (!token || !email) {
        setValidationError('The password reset link is incomplete.');
        setIsValidating(false);
        return;
      }

      try {
        const response = await authApi.validateResetToken({ token, email });
        if (!active) {
          return;
        }

        setIsTokenValid(Boolean(response.data.valid));
        setValidationError(response.data.valid ? '' : response.data.message || 'This reset link is invalid or expired.');
      } catch (requestError: any) {
        if (!active) {
          return;
        }

        setIsTokenValid(false);
        setValidationError(requestError?.response?.data?.message || 'This reset link is invalid or expired.');
      } finally {
        if (active) {
          setIsValidating(false);
        }
      }
    };

    validateToken();

    return () => {
      active = false;
    };
  }, [email, token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setValidationError('');
    setSuccessMessage('');

    if (password !== passwordConfirmation) {
      setValidationError('Passwords do not match.');
      return;
    }

    // Do not send something the server will certainly refuse; the rules are
    // listed under the field, so the joiner has already been told.
    if (evaluatePassword(password).score < 4) {
      setValidationError('Your password does not meet the requirements listed below the field.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await authApi.resetPassword({
        token,
        email,
        password,
        password_confirmation: passwordConfirmation,
      });

      setSuccessMessage(response.data.message || 'Your password has been reset.');
      setPassword('');
      setPasswordConfirmation('');
    } catch (requestError: any) {
      /*
       * Field errors first. Laravel puts the useful part in `errors` — the
       * breach-check rejection above all — while `message` is the generic
       * summary. Reading only the summary is how "your data is invalid" reached
       * users with nothing to act on.
       */
      const fieldErrors = requestError?.response?.data?.errors;
      const firstFieldError = fieldErrors
        ? Object.values(fieldErrors).flat().find(Boolean)
        : null;

      setValidationError(
        (typeof firstFieldError === 'string' ? firstFieldError : '')
        || requestError?.response?.data?.message
        || 'Unable to reset your password right now.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthPageShell
      backTo="/login"
      backLabel="Back to sign in"
      heading="Choose a new password"
      intro="Finish the reset and head back into your workspace."
      showcaseHeading="Reset links stay short-lived and separate from normal login."
      showcaseIntro="Token validation runs before the form submits, so you get a clear success or failure state without any change to how sessions are kept."
      features={FEATURES}
    >
      {validationError ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{validationError}</p>
        </div>
      ) : null}

      {successMessage ? (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {successMessage}{' '}
          <Link to="/login" className="font-semibold underline">
            Return to sign in
          </Link>
          .
        </div>
      ) : null}

      {isValidating ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
          Validating your reset link...
        </div>
      ) : null}

      {!isValidating && isTokenValid ? (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="reset-email" className={authLabelClass}>
              Email Address
            </label>
            <div className="relative">
              <Mail className={authIconClass} />
              <input
                id="reset-email"
                type="email"
                readOnly
                value={email}
                className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className={authLabelClass}>
              New password
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
            <PasswordStrength value={password} />
          </div>

          <div>
            <label htmlFor="password-confirmation" className={authLabelClass}>
              Confirm new password
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

          <button type="submit" disabled={isSubmitting} className={authPrimaryButtonClass}>
            {isSubmitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Resetting password...
              </>
            ) : (
              <>
                Reset password
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>
      ) : null}

      {!isValidating && !isTokenValid ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
          Request a fresh link from the{' '}
          <Link to="/forgot-password" className="font-semibold text-blue-600 transition hover:text-blue-700">
            forgot password
          </Link>{' '}
          page.
        </div>
      ) : null}
    </AuthPageShell>
  );
}
