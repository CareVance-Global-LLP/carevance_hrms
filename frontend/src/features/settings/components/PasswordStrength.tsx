import { cn } from '@/utils/cn';

export interface PasswordChecks {
  length: boolean;
  caseMix: boolean;
  number: boolean;
  symbol: boolean;
}

export const evaluatePassword = (value: string): { checks: PasswordChecks; score: number } => {
  const checks: PasswordChecks = {
    length: value.length >= 8,
    caseMix: /[a-z]/.test(value) && /[A-Z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { checks, score };
};

const REQUIREMENTS: Array<{ key: keyof PasswordChecks; label: string }> = [
  { key: 'length', label: 'At least 8 characters' },
  { key: 'caseMix', label: 'Upper and lower case' },
  { key: 'number', label: 'A number' },
  { key: 'symbol', label: 'A symbol' },
];

const SEGMENT_TONE = ['bg-red-500', 'bg-amber-500', 'bg-amber-500', 'bg-emerald-500'];

/**
 * Tells you whether the password will be accepted before you submit it.
 *
 * Worth stating plainly, because this component was the ONLY place in the app
 * that named the rules at all: accept-invite, reset-password and owner-signup
 * showed a bare box, so somebody setting their first password learned the policy
 * by being refused. It renders on all four now.
 *
 * The breach check is a note rather than a fifth tick on purpose. It cannot be
 * evaluated in the browser — it is a server-side k-anonymity lookup — and a
 * checkbox that never goes green reads as a rule you have failed.
 */
export default function PasswordStrength({ value }: { value: string }) {
  const { checks, score } = evaluatePassword(value);

  return (
    <div className="mt-3">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              value && index < score ? SEGMENT_TONE[score - 1] : 'bg-slate-200'
            )}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {REQUIREMENTS.map((requirement) => {
          const met = checks[requirement.key];
          return (
            <li
              key={requirement.key}
              className={cn('flex items-center gap-2 text-xs', met ? 'text-emerald-700' : 'text-slate-600')}
            >
              <span
                className={cn(
                  'h-3 w-3 shrink-0 rounded-full border transition',
                  met ? 'border-emerald-600 bg-emerald-600 ring-2 ring-inset ring-surface-card' : 'border-slate-300'
                )}
              />
              {requirement.label}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        Also checked against known data breaches when you submit — a password found in one
        is refused even if it meets everything above.
      </p>
    </div>
  );
}
