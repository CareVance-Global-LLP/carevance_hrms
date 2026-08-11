import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { billingApi } from '@/services/api';
import RenewalBanner from './RenewalBanner';
import { resolveRenewalNotice } from './renewalState';

const DISMISS_KEY = 'carevance.renewalBannerDismissed';

/**
 * Shows the renewal state across the whole app rather than only on the billing
 * page, because the one person who needs to see it is rarely on that page.
 *
 * Only workspace admins see it — nobody else can act on it, and a warning
 * addressed to someone who cannot pay is just noise.
 */
export default function WorkspaceRenewalBanner() {
  const { user } = useAuth();
  const location = useLocation();
  const isAdmin = hasStrictAdminAccess(user);
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });

  const { data } = useQuery({
    queryKey: ['billing-snapshot'],
    queryFn: async () => (await billingApi.current()).data,
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const notice = useMemo(() => resolveRenewalNotice(data ?? null), [data]);

  // The dismissal is keyed to the situation, not to the banner: a new stage or
  // a new renewal date produces a new key, so dismissing "renews in 7 days"
  // does not also silence "grace ends today".
  const noticeKey = notice ? `${notice.tone}:${data?.cycle?.period_end ?? ''}:${data?.cycle?.days_remaining ?? ''}` : null;

  if (!isAdmin || !notice || !noticeKey) {
    return null;
  }

  // The billing page renders its own, larger version of this.
  if (location.pathname.startsWith('/settings/billing')) {
    return null;
  }

  if (dismissedKey === noticeKey) {
    return null;
  }

  return (
    <RenewalBanner
      notice={notice}
      className="mb-4"
      onDismiss={() => {
        try {
          localStorage.setItem(DISMISS_KEY, noticeKey);
        } catch {
          // A browser refusing storage should still let the banner close for
          // this view; it will simply return on the next load.
        }
        setDismissedKey(noticeKey);
      }}
    />
  );
}
