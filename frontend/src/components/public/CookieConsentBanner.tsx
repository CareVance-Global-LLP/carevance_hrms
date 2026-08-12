import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import { buttonPrimaryClass, buttonSecondaryClass } from '@/components/ui/controlClasses';
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
      {/*
        Styled from ui/controlClasses, the same set the signed-out pages use.
        The old banner reached for `sky-*` and a hardcoded navy→sky gradient;
        neither follows the theme, so it read as a different product from the
        page it was sitting on.
      */}
      <AdaptiveSurface
        className="pointer-events-auto mx-auto max-w-4xl rounded-lg border border-slate-200 bg-white p-5 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)]"
        tone="light"
        backgroundColor="#ffffff"
        role="dialog"
        aria-label="Cookie preferences"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Cookie className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                  Cookie preferences
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
                  {hasSavedChoice ? 'Update your analytics choice' : 'Allow analytics cookies?'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Essential storage stays on for sign-in and core site behaviour. Analytics stays
                  off unless you accept it.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
            {hasSavedChoice ? (
              <button type="button" onClick={closePreferences} className={buttonSecondaryClass}>
                Close
              </button>
            ) : null}
            <button type="button" onClick={rejectNonEssential} className={buttonSecondaryClass}>
              Reject non-essential
            </button>
            <button type="button" onClick={acceptAll} className={buttonPrimaryClass}>
              Accept analytics
            </button>
          </div>
        </div>
      </AdaptiveSurface>
    </div>
  );
}
