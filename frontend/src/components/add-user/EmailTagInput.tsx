import { KeyboardEvent, useState } from 'react';
import { Mail, X } from 'lucide-react';
import { FieldLabel } from '@/components/ui/FormField';
import { normalizeEmails } from '@/services/addUser';

/**
 * Above this many recipients the inline code list is replaced by a pointer to
 * the CSV tab. Chosen to cover the ad-hoc case without turning the drawer into
 * a data-entry grid.
 */
const EMPLOYEE_CODE_INLINE_LIMIT = 10;

interface EmailTagInputProps {
  emails: string[];
  invalidEmails: string[];
  onChange: (emails: string[]) => void;
  onInvalidChange: (invalidEmails: string[]) => void;
  /**
   * The access level every recipient gets, shown on each chip as a plain label.
   *
   * It used to be a per-chip <select>, which contradicted the Access Level
   * control above it — two places setting the same thing, and the chip could
   * only ever offer the three built-in roles, so picking an admin-defined role
   * above and then touching a chip silently discarded it. One control now owns
   * the decision and the chips report it.
   */
  roleLabel?: string;
  /** Per-recipient employee codes, keyed by lower-cased email. */
  employeeCodeByEmail?: Record<string, string>;
  /** Omit to hide the per-recipient code control entirely. */
  onEmployeeCodeChange?: (email: string, code: string) => void;
}

export default function EmailTagInput({
  emails,
  invalidEmails,
  onChange,
  onInvalidChange,
  roleLabel,
  employeeCodeByEmail,
  onEmployeeCodeChange,
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
          {emails.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700"
            >
              <Mail className="h-3.5 w-3.5" />
              {email}
              {/*
                Read-only: the access level chosen above, echoed so it is clear
                what each recipient will get. Editing it here is deliberately
                not possible — see roleLabel on the props for why.
              */}
              {roleLabel ? (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                  {roleLabel}
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

      {/*
        Employee codes get their own row per recipient rather than a control on
        the chip. Every other field in this drawer is shared by the whole batch;
        a code identifies one person and must be unique, so it cannot be. A chip
        is too small to type an identifier into and read it back.

        Hidden entirely for a large paste: this is for the handful-of-people
        case, and the CSV tab already carries an employee_code column for the
        rest. Typing fifty codes into a drawer is the wrong tool.
      */}
      {onEmployeeCodeChange && emails.length > 0 && emails.length <= EMPLOYEE_CODE_INLINE_LIMIT ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-600">
            Employee codes <span className="font-normal text-slate-400">(optional — can be added later)</span>
          </p>
          <div className="mt-2 space-y-2">
            {emails.map((email) => (
              <div key={`code-${email}`} className="flex items-center gap-2">
                <span className="w-1/2 truncate text-xs text-slate-600" title={email}>{email}</span>
                <input
                  type="text"
                  maxLength={80}
                  value={employeeCodeByEmail?.[email.toLowerCase()] ?? ''}
                  onChange={(event) => onEmployeeCodeChange(email, event.target.value)}
                  aria-label={`Employee code for ${email}`}
                  placeholder="e.g., EMP-001"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {onEmployeeCodeChange && emails.length > EMPLOYEE_CODE_INLINE_LIMIT ? (
        <p className="mt-2 text-xs text-slate-500">
          {emails.length} recipients — use the CSV tab to import employee codes in bulk, or add them
          later from each employee's work details.
        </p>
      ) : null}
    </div>
  );
}
