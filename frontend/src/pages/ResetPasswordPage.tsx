import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import BrandLogo from '@/components/branding/BrandLogo';
import AuthPageFooter from '@/components/auth/AuthPageFooter';
import { authApi } from '@/services/api';

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
      setValidationError(requestError?.response?.data?.message || 'Unable to reset your password right now.');
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
                    to="/login"
                    aria-label="Back to login"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-600 shadow-[0_16px_35px_-24px_rgba(15,23,42,0.25)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-slate-950 hover:text-slate-950"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Link>
                </div>
                <BrandLogo variant="full" size="sm" className="mb-5 max-w-[16rem]" />
                <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-[3.1rem] sm:leading-[0.95]">
                  Choose a new password
                </h1>
                <p className="mt-4 text-base leading-8 text-slate-600">
                  Finish the password reset flow and head back into your existing workspace routes.
                </p>
              </div>

              {validationError ? (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <p className="text-sm text-red-700">{validationError}</p>
                </div>
              ) : null}

              {successMessage ? (
                <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4 text-sm text-emerald-700">
                  {successMessage} <Link to="/login" className="font-semibold underline">Return to login</Link>.
                </div>
              ) : null}

              {isValidating ? (
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/85 px-4 py-4 text-sm text-slate-600">
                  Validating your reset link...
                </div>
              ) : null}

              {!isValidating && isTokenValid ? (
                <form className="space-y-5" onSubmit={handleSubmit}>
                  <div>
                    <label htmlFor="reset-email" className="mb-2 block text-sm font-semibold text-slate-800">
                      Email address
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="reset-email"
                        type="email"
                        readOnly
                        value={email}
                        className="block w-full rounded-[22px] border border-slate-200/90 bg-slate-50 py-4 pl-12 pr-4 text-sm text-slate-500 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-800">
                      New password
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
                      Confirm new password
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
                    disabled={isSubmitting}
                    className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-4 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_58px_-20px_rgba(14,165,233,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? 'Resetting password...' : 'Reset password'}
                    {!isSubmitting ? <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /> : null}
                  </button>
                </form>
              ) : null}

              {!isValidating && !isTokenValid ? (
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/85 px-4 py-4 text-sm text-slate-600">
                  Request a fresh link from the <Link to="/forgot-password" className="font-semibold text-sky-700">forgot password</Link> page.
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
                  Reset links stay short-lived and separate from normal login.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-[1.08rem]">
                  Token validation runs before the form submits so users get a clear success or failure state without
                  affecting current auth persistence logic.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
