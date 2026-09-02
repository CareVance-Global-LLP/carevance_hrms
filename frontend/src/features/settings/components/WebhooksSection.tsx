import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Plus, RefreshCw, Webhook } from 'lucide-react';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/Toast';
import {
  integrationsApi,
  type WebhookDeliverySummary,
  type WebhookEndpointSummary,
} from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';
import SettingsCard from './SettingsCard';
import { brandLabel, webhookHeaderPrefix } from '@/config/brand';

const formatWhen = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/**
 * Outbound webhooks, and the delivery log that makes them debuggable.
 *
 * The delivery list with a per-delivery retry is the part that matters: a
 * webhook integration without one leaves "did you send it?" as a support
 * ticket, and a failed delivery with no way to resend is a lost event.
 */
export default function WebhooksSection() {
  const { show } = useToast();

  const [endpoints, setEndpoints] = useState<WebhookEndpointSummary[] | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliverySummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [endpointData, deliveryData] = await Promise.all([
        integrationsApi.listWebhooks(),
        integrationsApi.deliveries(),
      ]);
      setEndpoints(endpointData.endpoints);
      setEvents(endpointData.available_events);
      setDeliveries(deliveryData);
    } catch (error) {
      reportSilentError('settings.integrations.webhooks', error);
      setEndpoints([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (work: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await work();
      show({ kind: 'success', message: successMessage });
      await refresh();
    } catch (error: any) {
      show({ kind: 'error', message: error?.response?.data?.message || 'That did not go through.' });
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const issued = await integrationsApi.createWebhook({ name, url, events: [...chosen] });
      setSecret(issued);
      setName('');
      setUrl('');
      setChosen(new Set());
      setCreating(false);
      await refresh();
    } catch (error: any) {
      show({ kind: 'error', message: error?.response?.data?.message || 'Could not add that endpoint.' });
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      reportSilentError('settings.integrations.copySecret', error);
    }
  };

  if (endpoints === null) {
    return (
      <SettingsCard title="Webhooks">
        <p className="text-xs text-slate-500">Checking…</p>
      </SettingsCard>
    );
  }

  const failed = deliveries.filter((delivery) => delivery.status === 'failed');

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Webhooks"
        description={`${brandLabel} calls your systems when something happens here, so they do not have to poll. Every request is signed, retried with backoff, and recorded.`}
        aside={
          !creating && !secret ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add endpoint
            </Button>
          ) : null
        }
      >
        {secret && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">Copy this signing secret now</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              Verify it on every request:{' '}
              <code className="font-mono">HMAC-SHA256</code> over{' '}
              <code className="font-mono">{`{${webhookHeaderPrefix}Timestamp}.{raw body}`}</code>, compared
              against <code className="font-mono">{`${webhookHeaderPrefix}Signature`}</code>. It is not shown again.
            </p>
            <code className="mt-3 block break-all rounded-md border border-amber-200 bg-white px-2 py-2 font-mono text-xs text-slate-800">
              {secret}
            </code>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void copySecret()}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button size="sm" onClick={() => setSecret(null)} disabled={!copied}>
                {copied ? "I've saved it" : 'Copy it first'}
              </Button>
            </div>
          </div>
        )}

        {creating && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-surface-sunken p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="webhook-name">Name</FieldLabel>
                <TextInput
                  id="webhook-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ops alerts"
                />
              </div>
              <div>
                <FieldLabel htmlFor="webhook-url">Endpoint URL</FieldLabel>
                <TextInput
                  id="webhook-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/hooks/carevance"
                />
              </div>
            </div>

            {/* https only, enforced server-side too. A signature does not make
                plaintext transport acceptable for payroll and employee data. */}
            <p className="mt-1.5 text-xs text-slate-500">Must be https.</p>

            <p className="mt-4 text-xs font-medium text-slate-700">Which events?</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {events.map((event) => (
                <label
                  key={event}
                  htmlFor={`event-${event}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-surface-card px-3 py-2 font-mono text-xs text-slate-700"
                >
                  <input
                    id={`event-${event}`}
                    type="checkbox"
                    checked={chosen.has(event)}
                    onChange={(changeEvent) =>
                      setChosen((current) => {
                        const next = new Set(current);
                        if (changeEvent.target.checked) next.add(event);
                        else next.delete(event);
                        return next;
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  {event}
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={() => void create()}
                disabled={busy || !name || !url || chosen.size === 0}
                loading={busy}
              >
                Add endpoint
              </Button>
              <Button variant="secondary" onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {endpoints.length === 0 && !creating && (
          <p className="text-xs leading-5 text-slate-600">No endpoints yet.</p>
        )}

        {endpoints.map((endpoint) => (
          <div
            key={endpoint.id}
            className="flex flex-wrap items-center gap-3 border-t border-slate-200 py-3 first:border-t-0 first:pt-0"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-surface-sunken text-slate-600">
              <Webhook className="h-4 w-4" />
            </span>
            <div className="min-w-[12rem] flex-1">
              <p className="text-sm font-medium text-slate-900">{endpoint.name}</p>
              <p className="mt-0.5 break-all font-mono text-xs text-slate-500">{endpoint.url}</p>
              <p className="mt-0.5 text-xs text-slate-600">{endpoint.events.join(' · ')}</p>
              {endpoint.disabled_reason && (
                <p className="mt-1 text-xs text-amber-700">{endpoint.disabled_reason}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {endpoint.disabled_at ? (
                <StatusBadge tone="danger">Disabled</StatusBadge>
              ) : endpoint.consecutive_failures > 0 ? (
                <StatusBadge tone="warning">{endpoint.consecutive_failures} failing</StatusBadge>
              ) : (
                <StatusBadge tone="success">Active</StatusBadge>
              )}
              {endpoint.disabled_at && (
                <Button
                  size="sm"
                  onClick={() => void run(() => integrationsApi.enableWebhook(endpoint.id), 'Endpoint re-enabled.')}
                  disabled={busy}
                >
                  Re-enable
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void run(() => integrationsApi.deleteWebhook(endpoint.id), 'Endpoint deleted.')}
                disabled={busy}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </SettingsCard>

      {deliveries.length > 0 && (
        <SettingsCard
          title="Recent deliveries"
          description="What was sent, what came back, and anything that gave up."
          aside={failed.length > 0 ? <StatusBadge tone="danger">{failed.length} failed</StatusBadge> : null}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Sent</th>
                  <th className="py-2 pr-3 font-medium">Result</th>
                  <th className="py-2 pr-3 font-medium">Tries</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {deliveries.slice(0, 25).map((delivery) => (
                  <tr key={delivery.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="py-2 pr-3 font-mono text-slate-800">{delivery.event}</td>
                    <td className="py-2 pr-3 text-slate-600">{formatWhen(delivery.created_at)}</td>
                    <td className="py-2 pr-3">
                      {delivery.status === 'delivered' && <StatusBadge tone="success">Delivered</StatusBadge>}
                      {delivery.status === 'pending' && <StatusBadge tone="info">Pending</StatusBadge>}
                      {delivery.status === 'failed' && (
                        <span className="flex flex-col gap-0.5">
                          <StatusBadge tone="danger">Failed</StatusBadge>
                          {delivery.error && <span className="text-slate-500">{delivery.error}</span>}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-slate-600">{delivery.attempts}</td>
                    <td className="py-2 text-right">
                      {delivery.status === 'failed' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(() => integrationsApi.retryDelivery(delivery.id), 'Queued for delivery.')
                          }
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsCard>
      )}
    </div>
  );
}
