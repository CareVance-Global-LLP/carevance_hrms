import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import { useConsent } from '@/contexts/ConsentContext';
import { isIndexableMarketingPath } from '@/lib/publicRoutes';
import { Cookie } from 'lucide-react';
import { useLocation } from 'react-router-dom';

export default function CookieConsentBanner() {
  const location = useLocation();
  const {
    consent,
    preferencesOpen,
    acceptAll,
    rejectNonEssential,
    closePreferences,
  } = useConsent();

  // Only surface the consent banner on genuine public/marketing pages. Rendering
  // it inside the authenticated app (e.g. /leave, /attendance) overlays and
  // blocks the page's own action buttons at the bottom of the viewport.
  const isVisible =
    isIndexableMarketingPath(location.pathname) &&
    (consent.status === 'pending' || preferencesOpen);

  if (!isVisible) {
    return null;
  }

  const hasSavedChoice = consent.status !== 'pending';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6 lg:px-8">
      <AdaptiveSurface
        className="pointer-events-auto mx-auto max-w-4xl rounded-[24px] border border-slate-200/85 bg-white/90 p-4 shadow-[0_28px_70px_-42px_rgba(15,23,42,0.42)] backdrop-blur-2xl sm:p-5"
        tone="light"
        backgroundColor="rgba(255,255,255,0.90)"
        role="dialog"
        aria-label="Cookie preferences"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 shadow-[0_14px_28px_-20px_rgba(14,165,233,0.45)]">
                <Cookie className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">Cookie preferences</p>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.04em] text-slate-950 sm:text-[1.35rem]">
                  {hasSavedChoice ? 'Update your analytics choice' : 'Allow analytics cookies?'}
                </h2>
              </div>
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-[0.95rem]">
              {hasSavedChoice ? 'Update your analytics cookie choice' : 'Choose whether analytics cookies can run'}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Essential storage stays on for sign-in and core site behavior. Non-essential analytics stays off unless you accept it.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
            {hasSavedChoice ? (
              <button
                type="button"
                onClick={closePreferences}
                className="inline-flex min-w-[104px] items-center justify-center rounded-[16px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:text-slate-950"
              >
                Close
              </button>
            ) : null}
            <button
              type="button"
              onClick={rejectNonEssential}
              className="inline-flex min-w-[148px] items-center justify-center rounded-[16px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:text-slate-950"
            >
              Reject non-essential
            </button>
            <button
              type="button"
              onClick={acceptAll}
              className="inline-flex min-w-[148px] items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#020617_0%,#0f172a_36%,#0284c7_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_45px_-20px_rgba(14,165,233,0.45)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_52px_-22px_rgba(14,165,233,0.52)]"
            >
              Accept analytics
            </button>
          </div>
        </div>
      </AdaptiveSurface>
    </div>
  );
}
