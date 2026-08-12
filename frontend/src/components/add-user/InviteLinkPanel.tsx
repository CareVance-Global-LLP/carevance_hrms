import { useEffect, useState } from 'react';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';

interface InviteLinkPanelProps {
  email: string;
  inviteUrl: string;
  onEmailChange: (value: string) => void;
  onGenerate: () => void;
  onCopy: () => void;
  isGenerating?: boolean;
  isCopying?: boolean;
  /** Role the generated link grants, echoed back so it can be checked before sharing. */
  role?: string;
  /** Hours the link stays valid — the value actually sent with the request. */
  expiresInHours?: number;
}

/**
 * When a link generated now will stop working, as an absolute local time.
 *
 * Absolute rather than a countdown: the admin is about to paste this into a
 * message and needs something they can type to the recipient, not a number that
 * is stale the moment the tab is left open.
 */
const expiryLabel = (hours: number): string => {
  const expires = new Date(Date.now() + hours * 60 * 60 * 1000);
  return expires.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export default function InviteLinkPanel({
  email,
  inviteUrl,
  onEmailChange,
  onGenerate,
  onCopy,
  isGenerating = false,
  isCopying = false,
  role,
  expiresInHours,
}: InviteLinkPanelProps) {
  /*
   * Copy confirmation, held for a moment after the mutation settles.
   *
   * The button previously showed "Copying…" while the mutation ran and then
   * snapped back to "Copy Link", so on a fast clipboard write nothing visibly
   * happened — leaving the admin unsure whether it had worked, on the one panel
   * where the value cannot be recovered if they get it wrong.
   */
  const [justCopied, setJustCopied] = useState(false);
  useEffect(() => {
    if (!justCopied) return undefined;
    const timer = setTimeout(() => setJustCopied(false), 2200);
    return () => clearTimeout(timer);
  }, [justCopied]);

  // A fresh link invalidates the previous confirmation.
  useEffect(() => {
    setJustCopied(false);
  }, [inviteUrl]);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-slate-950">Single-use secure invite link</p>
        <p className="mt-1 text-sm text-slate-500">
          Generate a secure invite URL for one email address. The recipient lands on CareVance with the invited email and role already locked.
        </p>
      </div>

      <div>
        <FieldLabel htmlFor="invite-link-email">Recipient Email</FieldLabel>
        <TextInput
          id="invite-link-email"
          type="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="new.user@company.com"
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Invite URL</p>
        <p className="mt-2 break-all text-sm font-medium text-slate-950">
          {inviteUrl || 'Generate a link to preview the onboarding URL.'}
        </p>

        {/*
          What the link actually grants, echoed only once one exists.

          The role and expiry are both chosen above and both sent with the
          request, but neither was shown back — so there was nothing to check
          against before pasting a single-use URL into a message.
        */}
        {inviteUrl ? (
          <dl className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-200 pt-3 sm:grid-cols-3">
            <div>
              <dt className="text-[11px] uppercase tracking-[0.14em] text-slate-500">For</dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-slate-900">{email || '—'}</dd>
            </div>
            {role ? (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Grants</dt>
                <dd className="mt-0.5 text-sm font-medium capitalize text-slate-900">{role}</dd>
              </div>
            ) : null}
            {typeof expiresInHours === 'number' ? (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Expires</dt>
                <dd className="mt-0.5 text-sm font-medium text-slate-900">{expiryLabel(expiresInHours)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      {/*
        Was a note to the next developer, rendered to admins: "keep this panel
        as the starting point for a future multi-use flow". Replaced with what
        the person using it actually needs to know — chiefly that only a hash of
        the token is stored, so this URL cannot be looked up again later.
      */}
      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        This link works once and is shown only now — copy it before you leave this page.
        If you lose it, generate a new link from Pending Invitations; the old one stops working.
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={onGenerate} disabled={isGenerating || !email.trim()}>
          {isGenerating ? 'Generating...' : inviteUrl ? 'Generate a new link' : 'Generate Invite Link'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onCopy();
            setJustCopied(true);
          }}
          disabled={!inviteUrl || isCopying}
        >
          {isCopying ? 'Copying...' : justCopied ? 'Copied ✓' : 'Copy Link'}
        </Button>
        {justCopied ? (
          <p role="status" className="self-center text-sm text-emerald-700">
            Copied — paste it before this page is closed.
          </p>
        ) : null}
      </div>
    </div>
  );
}
