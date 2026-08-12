import { KeyboardEvent, useState } from 'react';
import { Mail, X } from 'lucide-react';
import { FieldLabel } from '@/components/ui/FormField';
import { normalizeEmails, type InviteUserRole } from '@/services/addUser';

const ROLE_OPTIONS: Array<{ value: InviteUserRole; label: string }> = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

interface EmailTagInputProps {
  emails: string[];
  invalidEmails: string[];
  onChange: (emails: string[]) => void;
  onInvalidChange: (invalidEmails: string[]) => void;
  /** Role applied to anyone without an override. */
  defaultRole?: InviteUserRole;
  /** Per-recipient overrides, keyed by lower-cased email. */
  roleByEmail?: Record<string, InviteUserRole>;
  /** Omit to hide the per-chip role control entirely. */
  onRoleChange?: (email: string, role: InviteUserRole) => void;
  /** Roles this admin may grant — anything else is filtered out. */
  allowedRoles?: string[];
}

export default function EmailTagInput({
  emails,
  invalidEmails,
  onChange,
  onInvalidChange,
  defaultRole = 'employee',
  roleByEmail,
  onRoleChange,
  allowedRoles,
}: EmailTagInputProps) {
  const roleChoices = allowedRoles
    ? ROLE_OPTIONS.filter((option) => allowedRoles.includes(option.value))
    : ROLE_OPTIONS;
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
          {emails.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700"
            >
              <Mail className="h-3.5 w-3.5" />
              {email}
              {/*
                Role per recipient, not per batch.

                One RoleSelector used to apply to everybody, so inviting two
                employees and a manager meant sending two separate batches. The
                API still takes one role per request — addUserService groups by
                role and sends one request per group, so that stays invisible.
              */}
              {onRoleChange && roleChoices.length > 1 ? (
                <select
                  value={roleByEmail?.[email.toLowerCase()] ?? defaultRole}
                  onChange={(event) => onRoleChange(email, event.target.value as InviteUserRole)}
                  aria-label={`Role for ${email}`}
                  className="rounded-full border border-sky-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-sky-800 outline-none focus:ring-2 focus:ring-sky-300"
                >
                  {roleChoices.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
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
          ))}
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
