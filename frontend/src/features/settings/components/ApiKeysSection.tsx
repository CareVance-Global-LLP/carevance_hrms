import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/Toast';
import { integrationsApi, type ApiClientSummary } from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';
import SettingsCard from './SettingsCard';
import { brandLabel } from '@/config/brand';

const SCOPE_LABELS: Record<string, string> = {
  'employees.read': 'Read employees',
  'attendance.read': 'Read attendance',
  'leave.read': 'Read leave',
  'payroll.read': 'Read payroll',
  'timesheets.read': 'Read timesheets',
};

const formatWhen = (iso: string | null): string => {
  if (!iso) return 'never';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'never'
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * API keys for a customer's own systems.
 *
 * The key is shown once, at creation, because only its hash is kept — so the
 * reveal panel is a real part of the flow rather than a toast that can be
 * missed. Scopes are chosen per key: a key that can do everything is a
 * password with a longer name.
 */
export default function ApiKeysSection() {
  const { show } = useToast();

  const [keys, setKeys] = useState<ApiClientSummary[] | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await integrationsApi.listKeys();
      setKeys(data.keys);
      setScopes(data.available_scopes);
    } catch (error) {
      reportSilentError('settings.integrations.keys', error);
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    setBusy(true);
    try {
      const key = await integrationsApi.createKey({ name, scopes: [...chosen] });
      setIssuedKey(key);
      setName('');
      setChosen(new Set());
      setCreating(false);
      await refresh();
    } catch (error: any) {
      show({ kind: 'error', message: error?.response?.data?.message || 'Could not create that key.' });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number) => {
    setBusy(true);
    try {
      await integrationsApi.revokeKey(id);
      show({ kind: 'success', message: 'Key revoked. Anything using it stops working immediately.' });
      await refresh();
    } catch (error: any) {
      show({ kind: 'error', message: error?.response?.data?.message || 'Could not revoke that key.' });
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    if (!issuedKey) return;
    try {
      await navigator.clipboard.writeText(issuedKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      reportSilentError('settings.integrations.copyKey', error);
    }
  };

  if (keys === null) {
    return (
      <SettingsCard title="API keys">
        <p className="text-xs text-slate-500">Checking…</p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="API keys"
      description={`For your own systems to read data out of ${brandLabel}. Give each system its own key with only the access it needs — then revoking one never breaks the others.`}
      aside={
        !creating && !issuedKey ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            New key
          </Button>
        ) : null
      }
    >
      {issuedKey && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Copy this key now</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            Only a hash of it is stored, so it cannot be shown again or recovered. If you lose it,
            revoke this key and issue another.
          </p>
          <code className="mt-3 block break-all rounded-md border border-amber-200 bg-white px-2 py-2 font-mono text-xs text-slate-800">
            {issuedKey}
          </code>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void copyKey()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button size="sm" onClick={() => setIssuedKey(null)} disabled={!copied}>
              {copied ? "I've saved it" : 'Copy it first'}
            </Button>
          </div>
        </div>
      )}

      {creating && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-surface-sunken p-4">
          <div className="max-w-sm">
            <FieldLabel htmlFor="api-key-name">What is this key for?</FieldLabel>
            <TextInput
              id="api-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Tally sync, BI warehouse, …"
            />
          </div>

          <p className="mt-4 text-xs font-medium text-slate-700">What may it read?</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {scopes.map((scope) => (
              <label
                key={scope}
                htmlFor={`scope-${scope}`}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-surface-card px-3 py-2 text-xs text-slate-700"
              >
                <input
                  id={`scope-${scope}`}
                  type="checkbox"
                  checked={chosen.has(scope)}
                  onChange={(event) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(scope);
                      else next.delete(scope);
                      return next;
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                {SCOPE_LABELS[scope] ?? scope}
              </label>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void create()} disabled={busy || !name || chosen.size === 0} loading={busy}>
              Create key
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(false);
                setName('');
                setChosen(new Set());
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {keys.length === 0 && !creating && (
        <p className="text-xs leading-5 text-slate-600">No API keys yet.</p>
      )}

      {keys.map((key) => (
        <div
          key={key.id}
          className="flex flex-wrap items-center gap-3 border-t border-slate-200 py-3 first:border-t-0 first:pt-0"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-surface-sunken text-slate-600">
            <KeyRound className="h-4 w-4" />
          </span>
          <div className="min-w-[10rem] flex-1">
            <p className="text-sm font-medium text-slate-900">{key.name}</p>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{key.key_prefix}…</p>
            <p className="mt-0.5 text-xs text-slate-600">
              {key.scopes.map((scope) => SCOPE_LABELS[scope] ?? scope).join(' · ')} · last used{' '}
              {formatWhen(key.last_used_at)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {key.is_usable ? (
              <StatusBadge tone="success">Active</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">{key.revoked_at ? 'Revoked' : 'Expired'}</StatusBadge>
            )}
            {key.is_usable && (
              <Button variant="secondary" size="sm" onClick={() => void revoke(key.id)} disabled={busy}>
                Revoke
              </Button>
            )}
          </div>
        </div>
      ))}
    </SettingsCard>
  );
}
