import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import SettingsCard from './SettingsCard';
import { reportSilentError } from '@/lib/reportSilentError';
import {
  monitoringAlertRuleApi,
  type MonitoringAlertMetric,
  type MonitoringAlertRule,
} from '@/services/api';

/**
 * Manages the rules that raise a monitoring alert.
 *
 * The reports could always show that somebody tracked nothing yesterday; until
 * these existed, nothing said so unprompted. A rule is deliberately one metric,
 * one threshold — readable at a glance beats expressive and understood by
 * nobody.
 */

/** Thresholds are stored in the metric's own unit; the form speaks hours. */
const toStoredThreshold = (metric: MonitoringAlertMetric | undefined, input: string): number => {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) return 0;
  return metric?.unit === 'hours' ? Math.round(value * 3600) : Math.round(value);
};

const fromStoredThreshold = (metric: MonitoringAlertMetric | undefined, stored: number): string => {
  if (metric?.unit === 'hours') {
    const hours = stored / 3600;
    return String(Number.isInteger(hours) ? hours : Number(hours.toFixed(2)));
  }
  return String(stored);
};

export default function MonitoringAlertRules({ canManage }: { canManage: boolean }) {
  const [rules, setRules] = useState<MonitoringAlertRule[]>([]);
  const [metrics, setMetrics] = useState<MonitoringAlertMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [metric, setMetric] = useState('');
  const [threshold, setThreshold] = useState('6');

  const selectedMetric = metrics.find((item) => item.value === metric);

  const load = useCallback(async () => {
    try {
      const response = await monitoringAlertRuleApi.list();
      setRules(response.data.data ?? []);
      setMetrics(response.data.metrics ?? []);
      if (!metric && response.data.metrics?.length) {
        setMetric(response.data.metrics[0].value);
      }
    } catch (err) {
      reportSilentError('monitoring-alert-rules', err);
    } finally {
      setLoading(false);
    }
    // `metric` is read only to seed the first selection and must not re-trigger a load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    void load();
  }, [canManage, load]);

  if (!canManage) return null;

  const handleCreate = async () => {
    setError('');
    if (!name.trim()) {
      setError('Give the alert a name, so it is recognisable when it arrives.');
      return;
    }

    setSaving(true);
    try {
      await monitoringAlertRuleApi.create({
        name: name.trim(),
        metric,
        threshold: toStoredThreshold(selectedMetric, threshold),
      });
      setName('');
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save the alert.');
      reportSilentError('monitoring-alert-rules', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (rule: MonitoringAlertRule) => {
    try {
      await monitoringAlertRuleApi.update(rule.id, { is_enabled: !rule.is_enabled });
      await load();
    } catch (err) {
      reportSilentError('monitoring-alert-rules', err);
    }
  };

  const handleRemove = async (rule: MonitoringAlertRule) => {
    try {
      await monitoringAlertRuleApi.remove(rule.id);
      await load();
    } catch (err) {
      reportSilentError('monitoring-alert-rules', err);
    }
  };

  return (
    <SettingsCard
      title="Monitoring alerts"
      description="Checked once a day for the day before, and sent to admins and managers. Nothing is sent when nothing breaches."
    >
      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-slate-500">Loading alerts…</p>
        ) : rules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
            No alerts yet. Without one, a tracker that quietly stops recording looks the same as a quiet day.
          </p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{rule.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    Tell admins when somebody {rule.description}
                    {rule.group_name ? ` · ${rule.group_name} only` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => handleToggle(rule)}>
                    {rule.is_enabled ? 'On' : 'Off'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${rule.name}`}
                    onClick={() => handleRemove(rule)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <FieldLabel>Alert name</FieldLabel>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Short days" />
          </div>
          <div>
            <FieldLabel>Tell admins when somebody</FieldLabel>
            <SelectInput value={metric} onChange={(event) => setMetric(event.target.value)}>
              {metrics.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </SelectInput>
          </div>
          {selectedMetric && selectedMetric.unit !== 'none' ? (
            <div>
              <FieldLabel>{selectedMetric.unit === 'hours' ? 'Hours' : 'Percent'}</FieldLabel>
              <TextInput
                type="number"
                min="0"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
              />
            </div>
          ) : (
            <div className="hidden sm:block" />
          )}
          <div className="sm:col-span-3">
            {selectedMetric ? <p className="mb-2 text-xs text-slate-500">{selectedMetric.help}</p> : null}
            {error ? <p className="mb-2 text-xs text-rose-600">{error}</p> : null}
            <Button type="button" onClick={handleCreate} disabled={saving}>
              {saving ? 'Adding…' : 'Add alert'}
            </Button>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}

export { fromStoredThreshold, toStoredThreshold };
