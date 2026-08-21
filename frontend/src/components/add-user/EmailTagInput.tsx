import { KeyboardEvent, useState } from 'react';
import { Mail, X } from 'lucide-react';
import { FieldLabel } from '@/components/ui/FormField';
import { normalizeEmails } from '@/services/addUser';

interface EmailTagInputProps {
  emails: string[];
  invalidEmails: string[];
  onChange: (emails: string[]) => void;
  onInvalidChange: (invalidEmails: string[]) => void;
  /**
   * The batch default access level, shown on a chip that has no override.
   *
   * It used to be a per-chip <select>, which contradicted the Access Level
   * control above it — two places setting the same thing, and the chip could
   * only ever offer the three built-in roles, so picking an admin-defined role
   * above and then touching a chip silently discarded it. The chip is read-only
   * now; the recipient table below owns per-person overrides.
   */
  roleLabel?: string;
  /**
   * Resolved access-level label per recipient, keyed by lower-cased email.
   *
   * Only recipients who differ from the batch default appear here. Without it a
   * chip would keep announcing "Employee" for someone the table below has just
   * made a Manager — the same contradiction, one row further down.
   */
  roleLabelByEmail?: Record<string, string>;
}

export default function EmailTagInput({
  emails,
  invalidEmails,
  onChange,
  onInvalidChange,
  roleLabel,
  roleLabelByEmail,
}: EmailTagInputProps) {
  const [draft, setDraft] = useState('');

  const commitDraft = (value: string) => {
    if (!value.trim()) return;

    const { valid, invalid } = normalizeEmails(value);
    onChange(Array.from(new Set([...emails, ...valid])));
    onInvalidChange(invalid);
    setDraft('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      event.preventDefault();
      commitDraft(draft);
    }
  };

  return (
    <div>
      <FieldLabel hint={`${emails.length} added`}>Invite By Email</FieldLabel>
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {emails.map((email) => {
            // The override when there is one, else the batch default.
            const resolvedRoleLabel = roleLabelByEmail?.[email.trim().toLowerCase()] || roleLabel;

            return (
              <span
                key={email}
                className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700"
              >
                <Mail className="h-3.5 w-3.5" />
                {email}
                {/*
                  Read-only: the access level this recipient will get, echoed
                  from the controls that own it. Editing it here is deliberately
                  not possible — see roleLabel on the props for why.
                */}
                {resolvedRoleLabel ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                    {resolvedRoleLabel}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onChange(emails.filter((item) => item !== email))}
                  className="text-sky-500 transition hover:text-sky-700"
                  aria-label={`Remove ${email}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => commitDraft(draft)}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text');
              if (text.includes(',') || text.includes('\n')) {
                event.preventDefault();
                commitDraft(text);
              }
            }}
            placeholder="Type or paste email addresses"
            className="min-w-[16rem] flex-1 border-0 bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>
      </div>
      {invalidEmails.length > 0 ? (
        <p className="mt-2 text-sm text-rose-600">Invalid email format: {invalidEmails.join(', ')}</p>
      ) : (
        <p className="mt-2 text-xs text-slate-500">Use comma, enter, tab, or new lines to add multiple recipients.</p>
      )}

    </div>
  );
}
