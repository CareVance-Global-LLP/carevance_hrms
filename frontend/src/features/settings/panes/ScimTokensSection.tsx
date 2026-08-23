import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound } from 'lucide-react';
import { scimTokenApi } from '@/services/api';
import type { ScimToken } from '@/types';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { FieldLabel, TextInput } from '@/components/ui/FormField';

/**
 * Provisioning tokens for an identity provider.
 *
 * THE TOKEN IS SHOWN EXACTLY ONCE, and the screen says so before it is created
 * rather than after. It is stored hashed, so nobody — including whoever pressed
 * the button — can retrieve it afterwards, and somebody who closes the panel
 * without copying has to issue another.
 *
 * WHAT THIS TOKEN CAN DO IS STATED PLAINLY. It creates and deactivates users
 * across the whole workspace: a higher privilege than most administrators
 * exercise by hand, and not something to hand out on the strength of a label
 * that just says "SCIM".
 *
 * "NEVER USED" IS SURFACED, because a token that has never been called is
 * almost always one somebody pasted wrongly — and the symptom otherwise is
 * simply that nobody gets provisioned, which reads as the feature not working.
 */
export default function ScimTokensSection() {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [issued, setIssued] = useState('');
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  /*
   * Not window.confirm. A native OS dialog on a destructive action is the
   * loudest "this is a prototype" signal on the screen, it cannot be styled or
   * themed, and it fires on the red button - the one a buyer is most likely to
   * click while looking at you.
   */
  const [revoking, setRevoking] = useState<ScimToken | null>(null);
  const [error, setError] = useState('');

  const query = useQuery({
    queryKey: ['scim-tokens'],
    queryFn: async () => (await scimTokenApi.list()).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['scim-tokens'] });

  const create = useMutation({
    mutationFn: (name: string) => scimTokenApi.create(name),
    onSuccess: (response) => {
      setIssued(response.data.token);
      setCopied(false);
      setCreating(false);
      setError('');
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not create that token.'),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => scimTokenApi.revoke(id),
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (err: any) => setError(err?.response?.data?.message || 'Could not revoke that token.'),
  });

  const tokens = query.data?.data ?? [];
  const endpoint = query.data?.endpoint ?? '';

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <KeyRound className="h-3.5 w-3.5" /> Automatic provisioning (SCIM)
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          Single sign-on lets people <em>sign in</em> with your provider. This is what adds and — more importantly —
          removes them automatically when your directory changes.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {endpoint ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Tenant URL for your provider</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-900">{endpoint}</p>
        </div>
      ) : null}

      {issued ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-medium text-emerald-900">
            {/* Said at the moment it matters, not afterwards. */}
            Copy this now — it cannot be shown again.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded border border-emerald-200 bg-surface-card px-2 py-1 text-[11px]">
              {issued}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(issued);
                  setCopied(true);
                } catch {
                  // Clipboard access can be refused outright; the value is on
                  // screen and selectable either way.
                  setCopied(false);
                }
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      ) : null}

      {creating ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(String(new FormData(event.currentTarget).get('name') || ''));
          }}
        >
          <div className="min-w-[12rem] flex-1">
            <FieldLabel htmlFor={`${fieldId}-name`}>What is it for</FieldLabel>
            <TextInput id={`${fieldId}-name`} name="name" placeholder="Microsoft Entra" required />
            <p className="mt-1 text-[11px] text-amber-700">
              {/* Stated before the button, not after. */}
              This token can create and deactivate anybody in this workspace. Give it only to your identity provider.
            </p>
          </div>
          <Button type="submit" size="sm" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create token'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
          Create a token
        </Button>
      )}

      {tokens.length > 0 ? (
        <ul className="space-y-2">
          {tokens.map((token: ScimToken) => (
            <li key={token.id} className="rounded-lg border border-slate-200 bg-surface-card p-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-950">{token.name}</span>
                {token.token_hint ? (
                  <span className="font-mono text-[10px] text-slate-400">…{token.token_hint}</span>
                ) : null}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    token.is_live ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {token.is_live ? 'Live' : 'Revoked'}
                </span>
                {token.is_live ? (
                  <Button
                    className="ml-auto"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevoking(token)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>

              <p className="mt-0.5 text-[11px] text-slate-500">
                {token.last_used_at ? (
                  `Last used ${new Date(token.last_used_at).toLocaleString()}`
                ) : (
                  <span className="text-amber-700">
                    {/* Almost always a paste error, and the symptom otherwise
                        is simply that nobody gets provisioned. */}
                    Never used — check it was pasted into your provider correctly
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <ConfirmDialog
        isOpen={revoking !== null}
        title="Revoke this token?"
        message={
          revoking
            ? `"${revoking.name}" stops working immediately. Your identity provider can no longer create or deactivate people here, and joiners and leavers will stop syncing until you issue a new token and paste it in.`
            : ''
        }
        confirmLabel="Revoke token"
        tone="danger"
        isLoading={revoke.isPending}
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking.id);
          setRevoking(null);
        }}
        onClose={() => setRevoking(null)}
      />
    </div>
  );
}
