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
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import BrandLogo from '@/components/branding/BrandLogo';

export default function GoogleSignupCompletion() {
  const location = useLocation();
  const navigate = useNavigate();
  const { completeGoogleRegistration } = useAuth();

  const { name: initialName = '', email = '' } = (location.state as { name?: string; email?: string }) || {};

  const [name, setName] = useState(initialName);
  const [companyName, setCompanyName] = useState('');
  const [companyDescription, setCompanyDescription] = useState('');
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
        company_description: companyDescription,
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
                <BrandLogo variant="full" size="sm" className="mb-5 max-w-[16rem]" />
                <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-[3.1rem] sm:leading-[0.95]">
                  Complete your registration
                </h1>
                <p className="mt-4 text-base leading-8 text-slate-600">
                  We&apos;ve pre-filled your information from Google. Just add your company details to finish setting up your workspace.
                </p>
              </div>

              {error && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/90 p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <form className="space-y-5" onSubmit={handleSubmit}>
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
                      onChange={(e) => setName(e.target.value)}
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 pl-12 pr-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                      placeholder="Your full name"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="mb-2 block text-sm font-semibold text-slate-800">
                    Email (from Google)
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      disabled
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-slate-100 py-4 pl-12 pr-4 text-sm text-slate-500 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)]"
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    This email is verified through Google and cannot be changed.
                  </p>
                </div>

                <div>
                  <label htmlFor="company-name" className="mb-2 block text-sm font-semibold text-slate-800">
                    Company Name *
                  </label>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="company-name"
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 py-4 pl-12 pr-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                      placeholder="Acme Corporation"
                    />
                  </div>
                  {fieldErrors.company_name && (
                    <p className="mt-2 text-sm text-red-600">{fieldErrors.company_name[0]}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="company-description" className="mb-2 block text-sm font-semibold text-slate-800">
                    Company Description (Optional)
                  </label>
                  <textarea
                    id="company-description"
                    value={companyDescription}
                    onChange={(e) => setCompanyDescription(e.target.value)}
                    rows={3}
                    className="block w-full rounded-[22px] border border-slate-200/90 bg-white/85 px-4 py-4 text-sm text-slate-950 placeholder-slate-400 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.22)] outline-none transition duration-300 focus:border-sky-300/90 focus:bg-white focus:ring-2 focus:ring-sky-300/30"
                    placeholder="Tell us about your company..."
                  />
                </div>

                <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/85 px-5 py-5">
                  <div className="flex items-start gap-3">
                    <Monitor className="mt-0.5 h-5 w-5 text-emerald-700" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-800">14-day free trial</p>
                      <p className="mt-1 text-xs leading-6 text-emerald-700">
                        Basic plan with 5 seats. No credit card required. Full access expires in 14 days.
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !name || !companyName}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#020617_0%,#0f172a_30%,#0284c7_100%)] px-5 py-4 text-sm font-semibold text-white shadow-[0_22px_50px_-18px_rgba(14,165,233,0.6)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_58px_-20px_rgba(14,165,233,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating workspace...
                    </>
                  ) : (
                    <>
                      Complete Registration
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>
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
                  Almost there!
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-[1.08rem]">
                  Complete this final step to create your CareVance workspace and start managing your team.
                </p>

                <div className="mt-8 space-y-4">
                  <div className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                        <span className="text-sm font-bold">1</span>
                      </div>
                      <div>
                        <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Google Authentication</p>
                        <p className="text-sm text-slate-600">✓ Completed</p>
                      </div>
                    </div>
                  </div>

                  <div className="glass-panel premium-ring rounded-[28px] px-5 py-5">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                        <span className="text-sm font-bold">2</span>
                      </div>
                      <div>
                        <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Company Details</p>
                        <p className="text-sm text-slate-600">In Progress</p>
                      </div>
                    </div>
                  </div>

                  <div className="glass-panel premium-ring rounded-[28px] px-5 py-5 opacity-60">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                        <span className="text-sm font-bold">3</span>
                      </div>
                      <div>
                        <p className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Dashboard Access</p>
                        <p className="text-sm text-slate-600">Ready to go</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
