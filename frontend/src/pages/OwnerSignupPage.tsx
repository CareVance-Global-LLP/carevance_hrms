import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
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
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import BrandLogo from '@/components/branding/BrandLogo';
import AuthPageFooter from '@/components/auth/AuthPageFooter';
import { useAuth } from '@/contexts/AuthContext';
import { analytics } from '@/lib/analytics';
import { apiUrl } from '@/lib/runtimeConfig';
import GoogleLoginButton from '@/components/auth/GoogleLoginButton';
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
  const isGoogleMode = Boolean(googleEmail);

  const initialPlanCode = searchParams.get('plan');
  const explicitMode = searchParams.get('mode') as SignupMode | null;
  const initialMode = explicitMode || defaultMode;
  const initialInterval = (searchParams.get('interval') as PricingBillingCycle | null) || 'monthly';
  const initialSeats = parseInt(searchParams.get('seats') || String(initialMode === 'trial' ? TRIAL_SEATS : MIN_SEATS), 10);
  const modeLocked = explicitMode !== null;

  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState(googleName);
  const [email, setEmail] = useState(googleEmail);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [planCode, setPlanCode] = useState(initialMode === 'trial' ? 'basic' : getPricingPlan(initialPlanCode).code);
  const [signupMode, setSignupMode] = useState<SignupMode>(initialMode);
  const [billingCycle, setBillingCycle] = useState<PricingBillingCycle>(initialInterval);
  const [seats, setSeats] = useState(Math.max(initialSeats, initialMode === 'trial' ? TRIAL_SEATS : MIN_SEATS));
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showOrgDetails, setShowOrgDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Organization profile fields
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState('');
  const [size, setSize] = useState('');
  const [phone, setPhone] = useState('');
  const [orgEmail, setOrgEmail] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');

  useEffect(() => {
    if (signupMode === 'trial') {
      setPlanCode('basic');
      setSeats(TRIAL_SEATS);
    } else {
      setSeats((s) => Math.max(s, MIN_SEATS));
    }
  }, [signupMode]);

  // Sync name/email from Google query params when they change (e.g. redirect from Google login)
  useEffect(() => {
    if (googleName) {
      setName(googleName);
    }
    if (googleEmail) {
      setEmail(googleEmail);
    }
  }, [googleName, googleEmail]);

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
        await completeGoogleRegistration({
          name: name.trim(),
          company_name: companyName.trim(),
          company_description: description.trim() || undefined,
          plan_code: planCode,
          billing_cycle: billingCycle,
          seats,
          signup_mode: signupMode,
          description: description.trim() || undefined,
          website: website.trim() || undefined,
          industry: industry || undefined,
          size: size || undefined,
          phone: phone.trim() || undefined,
          org_email: orgEmail.trim() || undefined,
          address_line: addressLine.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          postal_code: postalCode.trim() || undefined,
          country: country.trim() || undefined,
        });
        analytics.trackEvent('google_signup_completed', {
          plan_code: planCode,
          signup_mode: signupMode,
        });
        navigate('/dashboard');
        return;
      }

      const result = await signupOwner({
        company_name: companyName.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
        password_confirmation: passwordConfirmation,
        plan_code: planCode,
        signup_mode: signupMode,
        billing_cycle: billingCycle,
        seats,
        ...(termsAccepted ? { terms_accepted: true } : {}),
        // Organization profile fields (only include if provided)
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(website.trim() ? { website: website.trim() } : {}),
        ...(industry ? { industry } : {}),
        ...(size ? { size } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(orgEmail.trim() ? { org_email: orgEmail.trim() } : {}),
        ...(addressLine.trim() ? { address_line: addressLine.trim() } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(state.trim() ? { state: state.trim() } : {}),
        ...(postalCode.trim() ? { postal_code: postalCode.trim() } : {}),
        ...(country.trim() ? { country: country.trim() } : {}),
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
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#fcfdff_0%,#f2f8ff_26%,#eef5ff_56%,#f8fafc_100%)] text-slate-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.32),transparent_58%)]" />
      <div className="pointer-events-none absolute -left-16 top-28 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="pointer-events-none absolute right-[-6rem] top-40 h-[28rem] w-[28rem] rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="hero-grid pointer-events-none absolute inset-0 opacity-55" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col lg:flex-row">
        <section className="order-1 flex w-full items-center justify-center px-4 py-10 sm:px-6 lg:w-1/2 lg:px-10">
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
                  {isGoogleMode ? 'Complete your workspace setup' : 'Start your CareVance workspace'}
                </h1>
                <p className="mt-4 text-base leading-8 text-slate-600">
                  {isGoogleMode
                    ? 'Your Google account is connected. Just add your company details to finish setting up your workspace.'
                    : 'Create the first workspace owner account, set your plan intent, and land directly in the dashboard with onboarding-ready billing state.'}
                </p>
                {!isGoogleMode && (
                  <p className="mt-3 text-sm text-slate-500">
                    Already have an account?{' '}
                    <Link
                      to="/login"
                      className="font-semibold text-sky-700 underline-offset-4 transition hover:text-slate-950 hover:underline"
                    >
                      Sign in
                    </Link>
                  </p>
                )}
              </div>

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
                  <div className="rounded-[24px] border border-sky-200 bg-sky-50/85 px-5 py-5">
                    <p className="text-sm font-semibold text-sky-900">{selectedPlan.label} Plan</p>
                    <p className="mt-1 text-xs leading-6 text-sky-700">
                      {selectedPlanPrice}/user/month · {billingCycle === 'yearly' ? 'Yearly billing' : 'Monthly billing'} · {seats} seats
                    </p>
                    <p className="mt-2 text-xs text-sky-600">Total: ₹{calculateTotal(selectedPlan, seats, billingCycle).toLocaleString('en-IN')}</p>
                  </div>
                ) : isTrialMode ? (
                  <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/85 px-5 py-5">
                    <p className="text-sm font-semibold text-emerald-800">14-day free trial</p>
                    <p className="mt-1 text-xs leading-6 text-emerald-700">Basic plan with 5 seats. No credit card required. Full access expires in 14 days.</p>
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
                          className={`rounded-[24px] border px-4 py-4 text-left transition ${
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
                  <label htmlFor="company-name" className="mb-2 block text-sm font-semibold text-slate-800">
                    Company Name
                  </label>
                  <div className="relative">
                    <Monitor className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="company-name"
                      type="text"
                      required
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 pl-12 pr-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                      placeholder="CareVance Labs"
                    />
                  </div>
                  {fieldErrors.company_name ? <p className="mt-2 text-sm text-red-600">{fieldErrors.company_name[0]}</p> : null}
                </div>

                <div>
                  <label htmlFor="name" className="mb-2 block text-sm font-semibold text-slate-800">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="name"
                      type="text"
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 pl-12 pr-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                      placeholder="Avery Morgan"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-semibold text-slate-800">
                    Work Email
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={isGoogleMode}
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 pl-12 pr-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30 disabled:bg-slate-100 disabled:text-slate-500"
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
                  <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-800">
                    Password
                  </label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
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
                  {fieldErrors.password ? <p className="mt-2 text-sm text-red-600">{fieldErrors.password[0]}</p> : null}
                </div>

                <div>
                  <label htmlFor="password-confirmation" className="mb-2 block text-sm font-semibold text-slate-800">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="password-confirmation"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={passwordConfirmation}
                      onChange={(event) => setPasswordConfirmation(event.target.value)}
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 pl-12 pr-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                      placeholder="********"
                    />
                  </div>
                {fieldErrors.password_confirmation ? <p className="mt-2 text-sm text-red-600">{fieldErrors.password_confirmation[0]}</p> : null}
                </div>
                  </>
                )}

                {/* Organization Details Toggle */}
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70">
                  <button
                    type="button"
                    onClick={() => setShowOrgDetails(!showOrgDetails)}
                    className="flex w-full items-center justify-between px-4 py-4 text-left"
                  >
                    <span className="text-sm font-semibold text-slate-800">Organization Details (Optional)</span>
                    <span className="text-xs text-slate-500 transition-transform duration-300" style={{ transform: showOrgDetails ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </button>
                  
                  {showOrgDetails && (
                    <div className="space-y-4 px-4 pb-4">
                      <div>
                        <label htmlFor="description" className="mb-2 block text-sm font-medium text-slate-700">
                          Description
                        </label>
                        <textarea
                          id="description"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                          placeholder="Tell us about your company..."
                          rows={3}
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="website" className="mb-2 block text-sm font-medium text-slate-700">
                            Website
                          </label>
                          <input
                            id="website"
                            type="url"
                            value={website}
                            onChange={(e) => setWebsite(e.target.value)}
                            className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                            placeholder="https://example.com"
                          />
                        </div>

                        <div>
                          <label htmlFor="industry" className="mb-2 block text-sm font-medium text-slate-700">
                            Industry
                          </label>
                          <select
                            id="industry"
                            value={industry}
                            onChange={(e) => setIndustry(e.target.value)}
                            className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                          >
                            <option value="">Select industry</option>
                            <option value="technology">Technology</option>
                            <option value="healthcare">Healthcare</option>
                            <option value="finance">Finance</option>
                            <option value="education">Education</option>
                            <option value="manufacturing">Manufacturing</option>
                            <option value="retail">Retail</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="size" className="mb-2 block text-sm font-medium text-slate-700">
                            Company Size
                          </label>
                          <select
                            id="size"
                            value={size}
                            onChange={(e) => setSize(e.target.value)}
                            className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                          >
                            <option value="">Select size</option>
                            <option value="1-10">1-10 employees</option>
                            <option value="11-50">11-50 employees</option>
                            <option value="51-200">51-200 employees</option>
                            <option value="201-500">201-500 employees</option>
                            <option value="500+">500+ employees</option>
                          </select>
                        </div>

                        <div>
                          <label htmlFor="org-phone" className="mb-2 block text-sm font-medium text-slate-700">
                            Phone Number
                          </label>
                          <input
                            id="org-phone"
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                            placeholder="+1 (555) 123-4567"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="org-email" className="mb-2 block text-sm font-medium text-slate-700">
                          Organization Email
                        </label>
                        <input
                          id="org-email"
                          type="email"
                          value={orgEmail}
                          onChange={(e) => setOrgEmail(e.target.value)}
                          className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                          placeholder="contact@company.com"
                        />
                      </div>

                      <div>
                        <label htmlFor="address" className="mb-2 block text-sm font-medium text-slate-700">
                          Address
                        </label>
                        <input
                          id="address"
                          type="text"
                          value={addressLine}
                          onChange={(e) => setAddressLine(e.target.value)}
                          className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                          placeholder="123 Business Street"
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="city" className="mb-2 block text-sm font-medium text-slate-700">
                            City
                          </label>
                          <input
                            id="city"
                            type="text"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                            placeholder="New York"
                          />
                        </div>

                        <div>
                          <label htmlFor="state" className="mb-2 block text-sm font-medium text-slate-700">
                            State/Province
                          </label>
                          <input
                            id="state"
                            type="text"
                            value={state}
                            onChange={(e) => setState(e.target.value)}
                            className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                            placeholder="NY"
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="postal-code" className="mb-2 block text-sm font-medium text-slate-700">
                            Postal Code
                          </label>
                          <input
                            id="postal-code"
                            type="text"
                            value={postalCode}
                            onChange={(e) => setPostalCode(e.target.value)}
                            className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                            placeholder="10001"
                          />
                        </div>

                        <div>
                          <label htmlFor="country" className="mb-2 block text-sm font-medium text-slate-700">
                            Country
                          </label>
                          <input
                            id="country"
                            type="text"
                            value={country}
                            onChange={(e) => setCountry(e.target.value)}
                            className="block w-full rounded-[18px] border border-slate-200/90 bg-white/85 px-4 py-3 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                            placeholder="United States"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <label className="flex items-start gap-3 rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4 text-sm text-slate-600">
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
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-4 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_58px_-20px_rgba(14,165,233,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
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
                  Owner signup creates the workspace, first admin, and billing state together.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-[1.08rem]">
                  The public flow is limited to the first workspace owner only. Everyone else joins through secure invitations with locked email and role assignment.
                </p>

                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  {isTrialMode ? (
                    <>
                      <div className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                        <ShieldCheck className="mb-3 h-5 w-5 text-emerald-700" />
                        <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Trial plan</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">Basic</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">5 seats included</p>
                      </div>
                      <div className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                        <Monitor className="mb-3 h-5 w-5 text-emerald-700" />
                        <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Trial duration</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">14 days</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">Exact expiry tracked from signup</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                        <ShieldCheck className="mb-3 h-5 w-5 text-sky-700" />
                        <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Selected plan</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{selectedPlan.label}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          {selectedPlanPrice}/user/month · {seats} seats
                        </p>
                      </div>
                      <div className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                        <Monitor className="mb-3 h-5 w-5 text-sky-700" />
                        <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Billing</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600 capitalize">{billingCycle}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">Total: ₹{calculateTotal(selectedPlan, seats, billingCycle).toLocaleString('en-IN')}</p>
                      </div>
                    </>
                  )}
                </div>

                <AdaptiveSurface
                  className="mt-8 rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,#06111f_0%,#020617_100%)] p-5 text-white shadow-[0_36px_90px_-42px_rgba(15,23,42,0.8)]"
                  tone="dark"
                  backgroundColor="#020617"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="contrast-text-accent text-xs font-semibold uppercase tracking-[0.3em]">What happens next</p>
                      <p className="contrast-text-primary mt-2 text-lg font-semibold tracking-[-0.04em]">From signup to team onboarding</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {isTrialMode ? (
                      <>
                        <div className="flex gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                            01
                          </div>
                          <div>
                            <p className="contrast-text-primary text-sm font-semibold">14-day trial starts</p>
                            <p className="contrast-text-secondary mt-1 text-sm leading-6">Basic plan with 5 seats activated. Exact expiry timestamp recorded.</p>
                          </div>
                        </div>
                        <div className="flex gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                            02
                          </div>
                          <div>
                            <p className="contrast-text-primary text-sm font-semibold">Basic features only</p>
                            <p className="contrast-text-secondary mt-1 text-sm leading-6">Advanced features locked until you upgrade to a paid plan.</p>
                          </div>
                        </div>
                        <div className="flex gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                            03
                          </div>
                          <div>
                            <p className="contrast-text-primary text-sm font-semibold">Upgrade anytime</p>
                            <p className="contrast-text-secondary mt-1 text-sm leading-6">Switch to Basic or Advanced paid plan before trial expires to keep access.</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/15 text-sm font-semibold text-cyan-200">
                            01
                          </div>
                          <div>
                            <p className="contrast-text-primary text-sm font-semibold">Create your account</p>
                            <p className="contrast-text-secondary mt-1 text-sm leading-6">Workspace is created with your selected plan and billing details.</p>
                          </div>
                        </div>
                        <div className="flex gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/15 text-sm font-semibold text-cyan-200">
                            02
                          </div>
                          <div>
                            <p className="contrast-text-primary text-sm font-semibold">Verify your email</p>
                            <p className="contrast-text-secondary mt-1 text-sm leading-6">Confirm your email address to activate the workspace.</p>
                          </div>
                        </div>
                        <div className="flex gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/15 text-sm font-semibold text-cyan-200">
                            03
                          </div>
                          <div>
                            <p className="contrast-text-primary text-sm font-semibold">Complete payment</p>
                            <p className="contrast-text-secondary mt-1 text-sm leading-6">Secure payment gateway opens. Pay to activate your dashboard.</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="mt-6 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-cyan-200" />
                      <p className="text-sm contrast-text-secondary">Need enterprise onboarding help? <Link to="/contact-sales" className="font-semibold text-white underline-offset-4 hover:underline">Contact sales</Link>.</p>
                    </div>
                  </div>
                </AdaptiveSurface>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
