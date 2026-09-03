import { legalLabel } from '@/config/brand';
import { useCallback, useEffect, useState } from 'react';
import { Activity, Camera, MapPin, Monitor, ScrollText, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminAccess } from '@/lib/permissions';
import { monitoringConsentApi, type MonitoringDisclosure } from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';
import SettingsCard from '../components/SettingsCard';
import PublishMonitoringNotice from '../components/PublishMonitoringNotice';

const CAPTURE_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  screenshot: { label: 'Screen images', icon: Monitor },
  activity: { label: 'Apps and websites', icon: Activity },
  location: { label: 'Location at clock-in', icon: MapPin },
  selfie: { label: 'Photo at clock-in', icon: Camera },
};

const formatDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

/**
 * What this organisation collects about the person reading the page, why, for
 * how long, and what they have agreed to.
 *
 * Written to what the DPDP Rules actually require of a consent notice: an
 * itemised description of the data and a specific purpose for each item, a
 * stated retention period, a named contact for grievances and the fact that a
 * complaint can go to the Data Protection Board — and consent that is per
 * purpose rather than one bundled yes.
 *
 * Nothing is pre-ticked, and withdrawal is a single click with no
 * interrogation, because the Rules require withdrawing to be as easy as
 * giving.
 */
export default function PrivacyPane() {
  const { show } = useToast();
  const { user } = useAuth();
  const isAdmin = hasAdminAccess(user);
  const [disclosure, setDisclosure] = useState<MonitoringDisclosure | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await monitoringConsentApi.disclosure();
      setDisclosure(next);
      setLoadError(null);
      // Reflects what is actually recorded. An unticked box for something not
      // yet agreed to is the honest starting state — pre-ticking would make
      // the affirmative action meaningless.
      setSelected(new Set(next.consent?.capture_types ?? []));
    } catch (error: any) {
      reportSilentError('settings.privacy.disclosure', error);

      /*
       * Say what went wrong. This screen previously returned null when the
       * request failed, so a 403 rendered a heading and an entirely empty
       * page — no error, no explanation, nothing to act on. A blank pane is
       * the worst possible failure mode for a screen whose whole purpose is
       * to disclose something.
       */
      setLoadError(
        error?.response?.data?.message
          || 'Could not load your privacy settings. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    setBusy(true);
    try {
      await monitoringConsentApi.grant([...selected]);
      show({ kind: 'success', message: 'Your choices have been recorded.' });
      await refresh();
    } catch (error: any) {
      show({ kind: 'error', message: error?.response?.data?.message || 'Could not record that.' });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      await monitoringConsentApi.withdraw();
      show({ kind: 'success', message: 'Consent withdrawn. Collection of this data will stop.' });
      await refresh();
    } catch (error: any) {
      show({ kind: 'error', message: error?.response?.data?.message || 'Could not withdraw.' });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SettingsCard title={`What ${legalLabel} collects about you`}>
        <p className="text-xs text-slate-500">Checking…</p>
      </SettingsCard>
    );
  }

  // Never render nothing. A screen whose purpose is disclosure must not fail
  // by disclosing nothing at all.
  if (!disclosure) {
    return (
      <SettingsCard title={`What ${legalLabel} collects about you`}>
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-900">This did not load</p>
            <p className="mt-0.5 text-xs leading-5 text-red-800">
              {loadError ?? 'Something went wrong.'}
            </p>
          </div>
        </div>
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
          >
            Try again
          </Button>
        </div>
      </SettingsCard>
    );
  }

  if (!disclosure.monitoring_enabled) {
    return (
      <SettingsCard
        title={`What ${legalLabel} collects about you`}
        aside={<StatusBadge tone="success">Monitoring off</StatusBadge>}
      >
        <p className="text-xs leading-5 text-slate-600">
          Your organisation has switched workplace monitoring off entirely. No screen images,
          activity, location or photographs are collected.
        </p>
      </SettingsCard>
    );
  }

  if (!disclosure.notice) {
    return (
      <div className="space-y-4">
        <SettingsCard title={`What ${legalLabel} collects about you`}>
          <p className="text-xs leading-5 text-slate-600">
            Your organisation has not published a monitoring notice yet, so there is nothing to agree
            to.
            {!isAdmin && ' Ask an administrator to publish one.'}
          </p>
        </SettingsCard>

        {/* Telling an administrator to "ask an administrator" is a dead end,
            so the person who can fix it is given the form instead. */}
        {isAdmin && <PublishMonitoringNotice currentVersion={null} onPublished={() => void refresh()} />}
      </div>
    );
  }

  const { notice, consent } = disclosure;
  const graceEnds = formatDate(disclosure.grace_ends_at);
  const hasActiveConsent = Boolean(consent?.is_current);
  const dirty =
    [...selected].sort().join(',') !== [...(consent?.capture_types ?? [])].sort().join(',');

  return (
    <div className="space-y-4">
      <SettingsCard
        title={`What ${legalLabel} collects about you`}
        description={`Notice version ${notice.version}. Kept for ${notice.retention_days} days, then deleted.`}
        aside={
          hasActiveConsent
            ? <StatusBadge tone="success">You have agreed</StatusBadge>
            : <StatusBadge tone="warning">Not agreed yet</StatusBadge>
        }
      >
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-surface-sunken p-3">
          <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <p className="whitespace-pre-line text-xs leading-5 text-slate-700">{notice.body}</p>
        </div>

        {/* Itemised, one row per kind of data, each with its own purpose and
            its own switch. A single bundled agreement would not be free or
            specific consent. */}
        <div className="mt-4 space-y-2">
          {Object.entries(disclosure.capture_types).map(([type, detail]) => {
            const meta = CAPTURE_LABELS[type] ?? { label: type, icon: ShieldCheck };
            const Icon = meta.icon;
            const checked = selected.has(type);

            return (
              <label
                key={type}
                htmlFor={`consent-${type}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-slate-300"
              >
                <input
                  id={`consent-${type}`}
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(type);
                      else next.delete(type);
                      return next;
                    });
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{meta.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                    {notice.purposes?.[type] ?? detail.purpose}
                  </span>
                  {!detail.allowed_now && detail.refusal_reason && (
                    <span className="mt-1 block text-xs text-amber-700">{detail.refusal_reason}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        {!hasActiveConsent && graceEnds && disclosure.policy === 'grace' && (
          <p className="mt-3 text-xs leading-5 text-amber-800">
            Collection continues until {graceEnds} while your organisation gathers responses. After
            that, anything you have not agreed to will stop being collected.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={busy || !dirty} loading={busy}>
            Save my choices
          </Button>

          {/*
            One click, always available, no confirmation dialogue and no reason
            box. The DPDP Rules require withdrawing to be no harder than
            giving; a "are you sure?" step that consent never had would fail
            that.
          */}
          {hasActiveConsent && (
            <Button variant="secondary" onClick={() => void withdraw()} disabled={busy}>
              Withdraw consent
            </Button>
          )}
        </div>

        {consent?.withdrawn_at && (
          <p className="mt-3 text-xs text-slate-600">
            You withdrew consent on {formatDate(consent.withdrawn_at)}.
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title="If you want to object"
        description="Raising a concern costs you nothing and does not need anyone's permission."
      >
        <p className="text-xs leading-5 text-slate-700">
          Contact{' '}
          <span className="font-medium text-slate-900">
            {notice.grievance.contact_name || 'your organisation'}
          </span>
          {notice.grievance.contact_email && (
            <>
              {' '}at{' '}
              <a
                href={`mailto:${notice.grievance.contact_email}`}
                className="font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                {notice.grievance.contact_email}
              </a>
            </>
          )}
          . If that does not resolve it, you may take a complaint to the{' '}
          <span className="font-medium text-slate-900">{notice.grievance.authority}</span>.
        </p>
      </SettingsCard>

      {isAdmin && (
        <PublishMonitoringNotice currentVersion={notice.version} onPublished={() => void refresh()} />
      )}
    </div>
  );
}
