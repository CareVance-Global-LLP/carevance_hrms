import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Monitor,
  ShieldCheck,
  User,
} from 'lucide-react';
import AuthPageShell, { authPrimaryButtonClass } from '@/components/auth/AuthPageShell';
import { useAuth } from '@/contexts/AuthContext';
import { analytics } from '@/lib/analytics';
import { apiUrl } from '@/lib/runtimeConfig';
import GoogleLoginButton from '@/components/auth/GoogleLoginButton';
import PasswordStrength, { evaluatePassword } from '@/features/settings/components/PasswordStrength';
import {
  calculateTotal,
  getPlanPrice,
  getPricingPlan,
  pricingPlans,
  pricingUi,
  PricingBillingCycle,
  SignupMode,
  MIN_SEATS,
  TRIAL_SEATS,
} from '@/constants/pricing';
import { brandLabel } from '@/config/brand';

interface ShowcaseStep {
  title: string;
  detail: string;
}

export type TrialPlanCode = 'basic_tracking' | 'basic_payroll';

/**
 * The two trial options, in the order they appear.
 *
 * `basic_payroll` is a strict superset of `basic_tracking` in both feature maps
 * (PlanService::FEATURES and usePlan's PLAN_FEATURES), so "Tracker + Payroll" is
 * additive rather than an alternative — which is why it is the default. Picking
 * the smaller one is the only choice that can cost the trialist anything, and it
 * stays switchable from billing settings for the length of the trial.
 */
const TRIAL_PLANS: Array<{
  value: TrialPlanCode;
  label: string;
  detail: string;
  recommended?: boolean;
}> = [
  {
    value: 'basic_tracking',
    label: 'Tracker',
    detail: 'Time tracking, screenshots, attendance, leave, projects & tasks',
  },
  {
    value: 'basic_payroll',
    label: 'Tracker + Payroll',
    detail: 'Everything in Tracker, plus payroll runs, statutory compliance and filings',
    recommended: true,
  },
];

const DEFAULT_TRIAL_PLAN: TrialPlanCode = 'basic_payroll';

const trialPlanLabel = (code: TrialPlanCode) =>
  TRIAL_PLANS.find((plan) => plan.value === code)?.label ?? 'Tracker';

const TRIAL_STEPS: ShowcaseStep[] = [
  { title: '14-day trial starts', detail: 'Full access to everything in your chosen plan, with the exact expiry recorded.' },
  { title: 'Set up your workspace', detail: 'A checklist and a guided tour walk you through the first steps.' },
  { title: 'Upgrade anytime', detail: 'Switch to a paid plan before the trial expires to keep access.' },
];

const PAID_STEPS: ShowcaseStep[] = [
  { title: 'Create your account', detail: 'The workspace is created with your selected plan and billing details.' },
  { title: 'Verify your email', detail: 'Confirm your address to activate the workspace.' },
  { title: 'Complete payment', detail: 'The secure payment gateway opens; paying activates your dashboard.' },
];

/**
 * The right-hand column: a plan summary that tracks the form, then the steps
 * that follow signup. Split out only because the page's form is long enough
 * that inlining this made the JSX hard to follow.
 */
function SignupShowcase({
  isTrialMode,
  selectedPlanLabel,
  selectedPlanPrice,
  seats,
  billingCycle,
  total,
  trialPlan,
}: {
  isTrialMode: boolean;
  selectedPlanLabel: string;
  selectedPlanPrice: number;
  seats: number;
  billingCycle: PricingBillingCycle;
  total: number;
  trialPlan: TrialPlanCode;
}) {
  const steps = isTrialMode ? TRIAL_STEPS : PAID_STEPS;

  return (
    <>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        <li className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-slate-900">
            {isTrialMode ? 'Trial plan' : 'Selected plan'}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {isTrialMode
              ? `${trialPlanLabel(trialPlan)} — ${TRIAL_SEATS} seats included`
              : `${selectedPlanLabel} · ${selectedPlanPrice}/user/month · ${seats} seats`}
          </p>
        </li>
        <li className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Monitor className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-slate-900">
            {isTrialMode ? 'Trial duration' : 'Billing'}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {isTrialMode
              ? '14 days, tracked from signup'
              : `${billingCycle} · total ₹${total.toLocaleString('en-IN')}`}
          </p>
        </li>
      </ul>

      <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">What happens next</p>
        <ol className="mt-4 space-y-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-semibold text-blue-600 ring-1 ring-slate-200">
                {index + 1}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 flex items-center gap-2 border-t border-slate-200 pt-4 text-xs text-slate-500">
          <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />
          Need enterprise onboarding help?{' '}
          <Link to="/contact-sales" className="font-semibold text-blue-600 transition hover:text-blue-700">
            Contact sales
          </Link>
        </p>
      </div>
    </>
  );
}

const formatError = (error: any) => {
  const fieldErrors = error?.response?.data?.errors;
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors).flat().find(Boolean)
    : null;
  const isNetworkFailure = !error?.response && (
    error?.code === 'ERR_NETWORK'
    || /network error/i.test(String(error?.message || ''))
  );

  return {
    message: firstFieldError
      || error?.response?.data?.message
      || (isNetworkFailure
        ? `Workspace signup could not reach the backend API at ${apiUrl}. Make sure the Laravel server is running, then try again.`
        : 'Unable to create your workspace right now.'),
    fieldErrors: fieldErrors || {},
  };
};

export default function OwnerSignupPage({ defaultMode = 'trial' }: { defaultMode?: SignupMode }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { signupOwner, completeGoogleRegistration } = useAuth();

  const googleName = searchParams.get('google_name') || '';
  const googleEmail = searchParams.get('google_email') || '';
  const emailParam = searchParams.get('email') || '';
  const isGoogleMode = Boolean(googleEmail);

  const initialPlanCode = searchParams.get('plan');
  const explicitMode = searchParams.get('mode') as SignupMode | null;
  const initialMode = explicitMode || defaultMode;
  const initialInterval = (searchParams.get('interval') as PricingBillingCycle | null) || 'monthly';
  const initialSeats = parseInt(searchParams.get('seats') || String(initialMode === 'trial' ? TRIAL_SEATS : MIN_SEATS), 10);
  const modeLocked = explicitMode !== null;

  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState(googleName);
  const [email, setEmail] = useState(googleEmail || emailParam);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [planCode, setPlanCode] = useState(initialMode === 'trial' ? DEFAULT_TRIAL_PLAN : getPricingPlan(initialPlanCode).code);
  const [trialPlan, setTrialPlan] = useState<TrialPlanCode>(DEFAULT_TRIAL_PLAN);
  const [signupMode, setSignupMode] = useState<SignupMode>(initialMode);
  const [billingCycle, setBillingCycle] = useState<PricingBillingCycle>(initialInterval);
  const [seats, setSeats] = useState(Math.max(initialSeats, initialMode === 'trial' ? TRIAL_SEATS : MIN_SEATS));
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Check if user was redirected because they have no organization
  const noOrgMessage = searchParams.get('message') === 'no-organization';

  // The company profile (description, website, industry, size, phone, address)
  // is deliberately NOT collected here. Every one of those columns used to be
  // written at signup and read by nothing, with no screen in the product to see
  // or edit them. They are now gathered inside the workspace through the setup
  // checklist and Settings → Organization, where the address also feeds the
  // invoice at conversion. See WorkspaceOnboardingController::billingProfile().

  useEffect(() => {
    if (signupMode === 'trial') {
      setPlanCode(trialPlan);
      setSeats(TRIAL_SEATS);
    } else {
      setSeats((s) => Math.max(s, MIN_SEATS));
    }
  }, [signupMode, trialPlan]);

  // Sync name/email from Google query params or email param when they change (e.g. redirect from Google login or login page)
  useEffect(() => {
    if (googleName) {
      setName(googleName);
    }
    if (googleEmail || emailParam) {
      setEmail(googleEmail || emailParam);
    }
  }, [googleName, googleEmail, emailParam]);

  const selectedPlan = useMemo(() => getPricingPlan(planCode), [planCode]);
  const selectedPlanPrice = getPlanPrice(selectedPlan, billingCycle);

  const isTrialMode = signupMode === 'trial';
  const isPaidMode = signupMode === 'paid';

  useEffect(() => {
    if (!selectedPlan.trialAvailable && signupMode === 'trial') {
      setSignupMode('paid');
    }
  }, [selectedPlan, signupMode]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setFieldErrors({});

    if (!isGoogleMode && password !== passwordConfirmation) {
      setError('Passwords do not match.');
      setFieldErrors({ password_confirmation: ['Passwords do not match.'] });
      return;
    }

    /*
     * Skipped in Google mode, where there is no password to check. Otherwise
     * stop before a request the server will certainly refuse — the rules are
     * listed under the field, so the person has already been told.
     */
    if (!isGoogleMode && evaluatePassword(password).score < 4) {
      setError('Your password does not meet the requirements listed below the field.');
      setFieldErrors({
        password: ['Check the requirements listed under this field.'],
      });
      return;
    }

    if (!termsAccepted) {
      setError('You must accept the terms and privacy policy before creating your workspace.');
      setFieldErrors({ terms_accepted: ['You must accept the terms and privacy policy before creating your workspace.'] });
      return;
    }

    setIsLoading(true);

    try {
      analytics.trackEvent('owner_signup_started', {
        plan_code: planCode,
        signup_mode: signupMode,
      });

      if (isGoogleMode) {
        const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        await completeGoogleRegistration({
          name: name.trim(),
          company_name: companyName.trim(),
          plan_code: planCode,
          billing_cycle: billingCycle,
          seats,
          signup_mode: signupMode,
          // The Google path used to drop this and hardcode the tracking plan,
          // so choosing "Tracker + Payroll" and then signing up with Google
          // silently downgraded the workspace.
          trial_plan: signupMode === 'trial' ? trialPlan : undefined,
          timezone: browserTimezone,
        });
        analytics.trackEvent('google_signup_completed', {
          plan_code: planCode,
          signup_mode: signupMode,
        });
        navigate('/dashboard');
        return;
      }

      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await signupOwner({
        company_name: companyName.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
        password_confirmation: passwordConfirmation,
        plan_code: planCode,
        signup_mode: signupMode,
        trial_plan: signupMode === 'trial' ? trialPlan : undefined,
        billing_cycle: billingCycle,
        seats,
        timezone: browserTimezone,
        ...(termsAccepted ? { terms_accepted: true } : {}),
      });

      analytics.trackEvent('owner_signup_completed', {
        plan_code: planCode,
        signup_mode: signupMode,
      });
      navigate(`/verify-email?email=${encodeURIComponent(result.email)}&status=pending-signup`);
    } catch (requestError: any) {
      const parsed = formatError(requestError);
      setError(parsed.message);
      setFieldErrors(parsed.fieldErrors);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthPageShell
      heading={isGoogleMode ? 'Complete your workspace setup' : `Start your ${brandLabel} workspace`}
      intro={
        isGoogleMode
          ? 'Your Google account is connected. Add your company details to finish setting up the workspace.'
          : 'Create the first workspace owner account, set your plan, and land in the dashboard with billing ready.'
      }
      introAside={
        !isGoogleMode ? (
          <>
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-blue-600 transition hover:text-blue-700">
              Sign in
            </Link>
          </>
        ) : null
      }
      showcaseHeading="Owner signup creates the workspace, first admin, and billing state together."
      showcaseIntro="The public flow is limited to the first workspace owner. Everyone else joins through a secure invitation with their email and role locked."
      showcaseBelow={
        <SignupShowcase
          isTrialMode={isTrialMode}
          selectedPlanLabel={selectedPlan.label}
          selectedPlanPrice={selectedPlanPrice}
          seats={seats}
          billingCycle={billingCycle}
          total={calculateTotal(selectedPlan, seats, billingCycle)}
          trialPlan={trialPlan}
        />
      }
    >
      <>
              {noOrgMessage ? (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="text-sm text-amber-800">
                    <p className="font-semibold">No workspace found</p>
                    <p className="mt-1">You don't have an active workspace. Create one below to start your free trial.</p>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              ) : null}

              {!isGoogleMode && (
                <>
                  <div className="mb-6">
                    <GoogleLoginButton type="signup" />
                  </div>

                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-white px-2 text-sm text-slate-500">Or sign up with email</span>
                    </div>
                  </div>
                </>
              )}

              <form className="space-y-5" onSubmit={handleSubmit}>
                {isPaidMode && initialPlanCode ? (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <p className="text-sm font-semibold text-sky-900">{selectedPlan.label} Plan</p>
                    <p className="mt-1 text-xs leading-6 text-sky-700">
                      {selectedPlanPrice}/user/month · {billingCycle === 'yearly' ? 'Yearly billing' : 'Monthly billing'} · {seats} seats
                    </p>
                    <p className="mt-2 text-xs text-sky-600">Total: ₹{calculateTotal(selectedPlan, seats, billingCycle).toLocaleString('en-IN')}</p>
                  </div>
                ) : isTrialMode ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-semibold text-emerald-800">14-day free trial</p>
                    <p className="mt-1 text-xs leading-6 text-emerald-700">Choose what to try. No credit card required. Full access expires in 14 days.</p>

                    {/* Trial Plan Selection */}
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {TRIAL_PLANS.map((plan) => {
                        const active = trialPlan === plan.value;
                        return (
                          <label
                            key={plan.value}
                            className={`cursor-pointer rounded-[16px] border px-4 py-3 transition ${
                              active
                                ? 'border-emerald-300 bg-emerald-100/50'
                                : 'border-emerald-200/50 bg-white/50 hover:bg-emerald-50/50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="trial_plan"
                              value={plan.value}
                              checked={active}
                              onChange={(event) => setTrialPlan(event.target.value as TrialPlanCode)}
                              className="sr-only"
                            />
                            <div className="flex items-start gap-3">
                              <div
                                className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                                  active ? 'border-emerald-500 bg-emerald-500' : 'border-emerald-300'
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-emerald-900">
                                  {plan.label}
                                  {plan.recommended ? (
                                    <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                                      Recommended
                                    </span>
                                  ) : null}
                                </p>
                                <p className="mt-0.5 text-xs leading-5 text-emerald-700/70">{plan.detail}</p>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <p className="mt-3 text-xs text-emerald-700/80">
                      {TRIAL_SEATS} seats included. You can switch this once during your trial.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {pricingPlans.map((plan) => {
                      const active = plan.code === planCode;
                      return (
                        <button
                          key={plan.code}
                          type="button"
                          onClick={() => setPlanCode(plan.code)}
                          className={`rounded-lg border px-4 py-3 text-left transition ${
                            active
                              ? 'border-sky-300 bg-sky-50/85 shadow-[0_22px_46px_-34px_rgba(14,165,233,0.45)]'
                              : 'border-slate-200/90 bg-white/85 hover:border-slate-300'
                          }`}
                        >
                          <p className="text-sm font-semibold text-slate-950">{plan.label}</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">{plan.shortDescription}</p>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div>
                  <label htmlFor="company-name" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Company Name
                  </label>
                  <div className="relative">
                    <Monitor className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      id="company-name"
                      type="text"
                      required
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 transition duration-200 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      placeholder="Acme Labs"
                    />
                  </div>
                  {fieldErrors.company_name ? <p className="mt-2 text-sm text-red-600">{fieldErrors.company_name[0]}</p> : null}
                </div>

                <div>
                  <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      id="name"
                      type="text"
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 transition duration-200 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      placeholder="Avery Morgan"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Work Email
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      id="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={isGoogleMode}
                      className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 transition duration-200 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"
                      placeholder="you@company.com"
                    />
                  </div>
                  {isGoogleMode && (
                    <p className="mt-2 text-xs text-slate-500">This email is verified through Google and cannot be changed.</p>
                  )}
                  {fieldErrors.email ? <p className="mt-2 text-sm text-red-600">{fieldErrors.email[0]}</p> : null}
                </div>

                {!isGoogleMode && (
                  <>
                <div>
                  <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Password
                  </label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-11 text-sm text-slate-900 placeholder-slate-400 transition duration-200 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      placeholder="********"
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
                  {fieldErrors.password ? <p className="mt-2 text-sm text-red-600">{fieldErrors.password[0]}</p> : null}
                  <PasswordStrength value={password} />
                </div>

                <div>
                  <label htmlFor="password-confirmation" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      id="password-confirmation"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={passwordConfirmation}
                      onChange={(event) => setPasswordConfirmation(event.target.value)}
                      className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 transition duration-200 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      placeholder="********"
                    />
                  </div>
                {fieldErrors.password_confirmation ? <p className="mt-2 text-sm text-red-600">{fieldErrors.password_confirmation[0]}</p> : null}
                </div>
                  </>
                )}

                <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    required
                    checked={termsAccepted}
                    onChange={(event) => setTermsAccepted(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 bg-white text-sky-600 focus:ring-sky-400"
                  />
                  <span>
                    I agree to the <Link to="/terms" className="font-semibold text-slate-900 underline-offset-4 hover:underline">terms</Link> and <Link to="/privacy" className="font-semibold text-slate-900 underline-offset-4 hover:underline">privacy policy</Link> for this workspace setup.
                    <span className="mt-1 block text-xs text-slate-500">Required to create the workspace and continue to email verification.</span>
                  </span>
                </label>
                {fieldErrors.terms_accepted ? <p className="mt-2 text-sm text-red-600">{fieldErrors.terms_accepted[0]}</p> : null}

                <button
                  type="submit"
                  disabled={isLoading || !termsAccepted}
                  className={authPrimaryButtonClass}
                >
                  {isLoading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Creating workspace...
                    </>
                  ) : (
                    <>
                      {signupMode === 'trial' ? 'Start free trial' : 'Proceed to Payment'}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>
      </>
    </AuthPageShell>
  );
}

