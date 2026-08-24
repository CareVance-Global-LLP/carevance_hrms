import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { samlConnectionApi } from '@/services/api';
import type { SamlConnection } from '@/types';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';
import { PageLoadingState } from '@/components/ui/PageState';
import ScimTokensSection from './ScimTokensSection';

/**
 * Signing in through the customer's own identity provider.
 *
 * Two failures dominate this integration, and both are total rather than
 * partial — everybody is locked out at once, including whoever could fix it:
 *
 * A connection that goes live the moment it is saved locks people out on a
 * typo, so a new one is created switched off and turning it on is a deliberate,
 * separate act with the consequence spelled out next to the switch.
 *
 * And the signing certificate expires, usually on a three-year cycle nobody
 * diarises. The expiry is shown on every connection rather than left to be
 * discovered on the morning it happens.
 */
export default function SingleSignOnPane() {
  const queryClient = useQueryClient();
  // One stable prefix per form, so every caption is tied to its control.
  // FieldLabel without htmlFor is decoration: a screen reader reaches the
  // field and announces "edit text, blank".
  const fieldId = useId();
  const [draft, setDraft] = useState<Partial<SamlConnection> | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const query = useQuery({
    queryKey: ['saml-connections'],
    queryFn: async () => (await samlConnectionApi.list()).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['saml-connections'] });

  const save = useMutation({
    mutationFn: (connection: Partial<SamlConnection>) =>
      connection.id
        ? samlConnectionApi.update(connection.id, connection)
        : samlConnectionApi.create(connection),
    onSuccess: () => {
      setDraft(null);
      setError('');
      invalidate();
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message || 'Could not save this connection.'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => samlConnectionApi.remove(id),
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message || 'Could not remove this connection.'),
  });

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 2000);
    } catch {
      // Clipboard access can be refused outright; the value is on screen and
      // selectable either way, so there is nothing useful to say about it.
      setCopied('');
    }
  };

  if (query.isLoading) {
    return <PageLoadingState label="Loading single sign-on..." />;
  }

  const connections = query.data?.data ?? [];
  const serviceProvider = query.data?.service_provider;

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {/* Step one of every setup guide any IdP publishes. */}
      {serviceProvider ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Paste these into your identity provider
          </p>

          <div className="mt-2 space-y-2">
            {([
              ['Identifier (Entity ID)', serviceProvider.entity_id],
              ['Reply URL (ACS)', serviceProvider.acs_url],
            ] as const).map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] font-medium text-slate-600">{label}</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900">
                    {value}
                  </code>
                  <Button variant="ghost" size="sm" onClick={() => copy(label, value)}>
                    {copied === label ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-2 text-xs text-slate-600">
            Providers that accept a metadata file can read{' '}
            <a
              className="underline"
              href={serviceProvider.metadata_url}
              target="_blank"
              rel="noreferrer"
            >
              our metadata
            </a>{' '}
            instead of typing both.
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        {connections.map((connection) => (
          <div key={connection.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="font-medium text-slate-950">{connection.name || 'Identity provider'}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  connection.is_active
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {connection.is_active ? 'Live' : 'Off'}
              </span>
              <span className="ml-auto text-xs text-slate-500">
                {connection.last_login_at
                  ? `last sign-in ${new Date(connection.last_login_at).toLocaleDateString()}`
                  : 'no sign-in yet'}
              </span>
            </div>

            <p className="mt-1 break-all text-xs text-slate-600">{connection.idp_entity_id}</p>

            <CertificateLine certificate={connection.certificate} />

            {connection.provision_users ? (
              <p className="mt-1 text-xs text-slate-600">
                {/* Said out loud: this creates accounts without anybody here
                    approving them, which is the part people miss. */}
                Anyone who can sign in at your provider and has no account here gets one created as{' '}
                {connection.default_role || 'employee'}.
              </p>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDraft(connection)}>
                Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => save.mutate({ id: connection.id, is_active: !connection.is_active })}
              >
                {connection.is_active ? 'Turn off' : 'Turn on'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => {
                  if (window.confirm('Remove this connection? Anyone who signs in through it will have to use a password instead.')) {
                    remove.mutate(connection.id);
                  }
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      {draft ? (
        <form
          className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(draft);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor={`${fieldId}-name`}>Name</FieldLabel>
              <TextInput
                id={`${fieldId}-name`}
                value={draft.name ?? ''}
                placeholder="Microsoft Entra ID"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <p className="mt-1 text-[11px] text-slate-500">Only for your own reference.</p>
            </div>

            <div>
              <FieldLabel htmlFor={`${fieldId}-issuer`}>Identifier / Entity ID</FieldLabel>
              <TextInput
                id={`${fieldId}-issuer`}
                value={draft.idp_entity_id ?? ''}
                placeholder="https://sts.windows.net/<tenant-id>/"
                onChange={(event) => setDraft({ ...draft, idp_entity_id: event.target.value.trim() })}
                required
              />
              <p className="mt-1 text-[11px] text-slate-500">
                From your provider, not from here. It is how we recognise a sign-in as yours.
              </p>
            </div>

            <div className="sm:col-span-2">
              <FieldLabel htmlFor={`${fieldId}-ssourl`}>Sign-on URL</FieldLabel>
              <TextInput
                type="url"
                id={`${fieldId}-ssourl`}
                value={draft.idp_sso_url ?? ''}
                placeholder="https://login.microsoftonline.com/<tenant-id>/saml2"
                onChange={(event) => setDraft({ ...draft, idp_sso_url: event.target.value.trim() })}
                required
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Must be https — people type their password on the other end of this link.
              </p>
            </div>

            <div className="sm:col-span-2">
              <FieldLabel htmlFor={`${fieldId}-cert`}>Signing certificate</FieldLabel>
              <TextareaInput
                id={`${fieldId}-cert`}
                rows={5}
                className="font-mono text-[11px]"
                placeholder={draft.id ? 'Paste a new certificate to replace the current one' : '-----BEGIN CERTIFICATE-----'}
                value={draft.idp_x509_cert ?? ''}
                onChange={(event) => setDraft({ ...draft, idp_x509_cert: event.target.value })}
                required={!draft.id}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {/* The trust anchor, in one sentence, because an admin pasting
                    the wrong file otherwise has no way to know it matters. */}
                This is what proves a sign-in really came from your provider. Leave blank when editing to keep the
                current one.
              </p>
            </div>

            <div>
              <FieldLabel htmlFor={`${fieldId}-emailattr`}>Email attribute</FieldLabel>
              <TextInput
                id={`${fieldId}-emailattr`}
                value={draft.email_attribute ?? ''}
                placeholder="Detected automatically"
                onChange={(event) => setDraft({ ...draft, email_attribute: event.target.value.trim() })}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Only needed if sign-ins fail with no email address. Entra, Okta and Google are already handled.
              </p>
            </div>

            <div>
              <FieldLabel htmlFor={`${fieldId}-provision`}>New people</FieldLabel>
              <SelectInput
                id={`${fieldId}-provision`}
                value={draft.provision_users ? 'create' : 'refuse'}
                onChange={(event) => setDraft({ ...draft, provision_users: event.target.value === 'create' })}
              >
                <option value="refuse">Must already have an account here</option>
                <option value="create">Create an account on first sign-in</option>
              </SelectInput>
            </div>

            {draft.provision_users ? (
              <div>
                <FieldLabel htmlFor={`${fieldId}-role`}>They join as</FieldLabel>
                <SelectInput
                  id={`${fieldId}-role`}
                  value={draft.default_role ?? 'employee'}
                  onChange={(event) => setDraft({ ...draft, default_role: event.target.value })}
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="hr">HR</option>
                </SelectInput>
                <p className="mt-1 text-[11px] text-slate-500">
                  {/* Administrator is deliberately not offered, and the server
                      refuses it too. */}
                  Nobody here approves these accounts, so they cannot be created as administrators.
                </p>
              </div>
            ) : null}
          </div>

          <label className="flex items-start gap-2 rounded border border-slate-200 bg-white p-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(draft.is_active)}
              onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
            />
            <span>
              Live
              <span className="block text-[11px] text-slate-500">
                {/* The consequence, next to the switch that causes it. */}
                While this is on, everyone whose email belongs to this workspace is sent to your provider to sign in.
                Leave it off until you have tested the connection.
              </span>
            </span>
          </label>

          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving...' : 'Save connection'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="secondary"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setDraft({ name: '', idp_entity_id: '', idp_sso_url: '', idp_x509_cert: '', is_active: false })}
        >
          Connect an identity provider
        </Button>
      )}

      <div className="border-t border-slate-200 pt-4">
        <ScimTokensSection />
      </div>
    </div>
  );
}

/**
 * When this connection stops working.
 *
 * Certificates expire and every sign-in in the organization fails at the same
 * moment, so this is stated in days rather than as a date somebody has to
 * subtract from today.
 */
function CertificateLine({ certificate }: { certificate: SamlConnection['certificate'] }) {
  if (!certificate) {
    return (
      <p className="mt-1 text-xs text-red-700">
        The stored certificate cannot be read. Sign-ins through this connection will fail — paste it again.
      </p>
    );
  }

  const days = certificate.days_remaining;
  const tone = days <= 0 ? 'text-red-700' : days <= 30 ? 'text-amber-700' : 'text-slate-600';

  return (
    <p className={`mt-1 text-xs ${tone}`}>
      Certificate {certificate.subject} ·{' '}
      {days <= 0
        ? `expired ${Math.abs(days)} days ago — sign-ins are failing`
        : `expires in ${days} days`}
    </p>
  );
}
