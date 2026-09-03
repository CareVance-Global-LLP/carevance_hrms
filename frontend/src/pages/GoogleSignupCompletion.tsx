import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { analytics } from '@/lib/analytics';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Loader2,
  Mail,
  Monitor,
  User,
} from 'lucide-react';
import AuthPageShell, {
  authIconClass,
  authInputClass,
  authInputWithIconClass,
  authLabelClass,
  authPrimaryButtonClass,
} from '@/components/auth/AuthPageShell';
import { brandLabel } from '@/config/brand';

/** The three-step progress rail, in place of the usual feature grid. */
const STEPS = [
  { label: 'Google authentication', state: 'Completed', tone: 'done' as const },
  { label: 'Company details', state: 'In progress', tone: 'active' as const },
  { label: 'Dashboard access', state: 'Ready to go', tone: 'pending' as const },
];

export default function GoogleSignupCompletion() {
  const location = useLocation();
  const navigate = useNavigate();
  const { completeGoogleRegistration } = useAuth();

  const { name: initialName = '', email = '' } = (location.state as { name?: string; email?: string }) || {};

  const [name, setName] = useState(initialName);
  const [companyName, setCompanyName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setIsLoading(true);

    try {
      analytics.trackEvent('google_signup_completion_started', {
        has_company_name: !!companyName,
      });

      await completeGoogleRegistration({
        name,
        company_name: companyName,
      });

      analytics.trackEvent('google_signup_completed', {
        company_name_provided: !!companyName,
      });

      navigate('/dashboard');
    } catch (err: any) {
      console.error('Complete registration error:', err);
      const message = err.response?.data?.message || err.message || 'Failed to complete registration';
      const errors = err.response?.data?.errors || {};

      setError(message);
      setFieldErrors(errors);

      analytics.trackEvent('google_signup_failed', {
        error: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthPageShell
      backTo={null}
      heading="Complete your registration"
      intro="We've pre-filled your details from Google. Add your company information to finish setting up the workspace."
      showcaseHeading="Almost there."
      showcaseIntro={`One more step and your ${brandLabel} workspace is created.`}
      showcaseBelow={
        <ol className="mt-8 space-y-3">
          {STEPS.map((step, index) => (
            <li
              key={step.label}
              className={`flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-5 ${
                step.tone === 'pending' ? 'opacity-60' : ''
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
                  step.tone === 'done'
                    ? 'bg-emerald-50 text-emerald-600'
                    : step.tone === 'active'
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {index + 1}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{step.label}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{step.state}</p>
              </div>
            </li>
          ))}
        </ol>
      }
    >
      {error && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="name" className={authLabelClass}>
            Full Name
          </label>
          <div className="relative">
            <User className={authIconClass} />
            <input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={authInputWithIconClass}
              placeholder="Your full name"
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className={authLabelClass}>
            Email (from Google)
          </label>
          <div className="relative">
            <Mail className={authIconClass} />
            <input
              id="email"
              type="email"
              value={email}
              disabled
              className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-500 outline-none"
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Verified through Google, so it cannot be changed here.
          </p>
        </div>

        <div>
          <label htmlFor="company-name" className={authLabelClass}>
            Company Name
          </label>
          <div className="relative">
            <Building2 className={authIconClass} />
            <input
              id="company-name"
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className={authInputWithIconClass}
              placeholder="Acme Corporation"
            />
          </div>
          {fieldErrors.company_name && (
            <p className="mt-1.5 text-sm text-red-600">{fieldErrors.company_name[0]}</p>
          )}
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold text-emerald-800">14-day free trial</p>
              <p className="mt-1 text-xs leading-5 text-emerald-700">
                Basic plan with 5 seats. No credit card required.
              </p>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading || !name || !companyName}
          className={authPrimaryButtonClass}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating workspace...
            </>
          ) : (
            <>
              Complete registration
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>
    </AuthPageShell>
  );
}
