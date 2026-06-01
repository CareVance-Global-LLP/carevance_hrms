import { gaMeasurementId, plausibleDomain, posthogKey } from '@/lib/runtimeConfig';

export type AnalyticsEventName =
  | 'landing_cta_clicked'
  | 'pricing_cta_clicked'
  | 'start_trial_clicked'
  | 'book_demo_clicked'
  | 'owner_signup_started'
  | 'owner_signup_completed'
  | 'login_submitted'
  | 'invite_accept_started'
  | 'invite_accept_completed'
  | 'contact_support_clicked'
  | 'bug_report_submitted'
  | 'google_signup_completion_started'
  | 'google_signup_completed'
  | 'google_signup_failed';

export interface AnalyticsPagePayload {
  path: string;
  title: string;
  url: string;
}

export interface AnalyticsEventPayload {
  [key: string]: unknown;
}

interface AnalyticsProvider {
  trackPageView: (payload: AnalyticsPagePayload) => void;
  trackEvent: (eventName: AnalyticsEventName, payload?: AnalyticsEventPayload) => void;
}

const dispatchAnalyticsLifecycleEvent = (
  type: 'page' | 'event',
  payload: AnalyticsPagePayload | { eventName: AnalyticsEventName; payload?: AnalyticsEventPayload }
) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('carevance:analytics-dispatch', {
      detail: {
        type,
        payload,
      },
    })
  );
};

const gtagProvider: AnalyticsProvider | null =
  gaMeasurementId && typeof window !== 'undefined' && typeof window.gtag === 'function'
    ? {
        trackPageView: ({ path, title, url }) => {
          window.gtag?.('config', gaMeasurementId, {
            page_path: path,
            page_title: title,
            page_location: url,
          });
        },
        trackEvent: (eventName, payload) => {
          window.gtag?.('event', eventName, payload || {});
        },
      }
    : null;

const plausibleProvider: AnalyticsProvider | null =
  plausibleDomain && typeof window !== 'undefined' && typeof window.plausible === 'function'
    ? {
        trackPageView: ({ path, url }) => {
          window.plausible?.('pageview', {
            props: {
              domain: plausibleDomain,
              path,
              url,
            },
          });
        },
        trackEvent: (eventName, payload) => {
          window.plausible?.(eventName, { props: payload || {} });
        },
      }
    : null;

const posthogProvider: AnalyticsProvider | null =
  posthogKey && typeof window !== 'undefined' && typeof window.posthog?.capture === 'function'
    ? {
        trackPageView: ({ path, title, url }) => {
          window.posthog?.capture('$pageview', {
            path,
            title,
            url,
          });
        },
        trackEvent: (eventName, payload) => {
          window.posthog?.capture(eventName, payload || {});
        },
      }
    : null;

const providers = [gtagProvider, plausibleProvider, posthogProvider].filter(
  (provider): provider is AnalyticsProvider => provider !== null
);

export const analytics = {
  trackPageView(payload: AnalyticsPagePayload) {
    dispatchAnalyticsLifecycleEvent('page', payload);
    providers.forEach((provider) => provider.trackPageView(payload));
  },
  trackEvent(eventName: AnalyticsEventName, payload?: AnalyticsEventPayload) {
    dispatchAnalyticsLifecycleEvent('event', { eventName, payload });
    providers.forEach((provider) => provider.trackEvent(eventName, payload));
  },
};
