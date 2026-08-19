import { forwardRef } from 'react';

type OneTimeCodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Allow letters and dashes so a recovery code can be typed into the same box. */
  allowRecoveryCode?: boolean;
  id?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

/**
 * A single input for a one-time code.
 *
 * Deliberately ONE field, not six boxes. The six-box pattern is what most
 * products ship, and it quietly costs a lot: separate inputs wired together
 * with keydown handlers break SMS and password-manager autofill, are painful
 * to navigate with a screen reader, lose undo, and mangle a partial paste. A
 * plain input with the right attributes gets all of that for free.
 *
 *   autocomplete="one-time-code"  lets iOS and Android offer the code
 *   inputmode="numeric"           brings up the number pad without the
 *                                 spinners and validation of type="number"
 *
 * Paste is explicitly not blocked: under a thirty-second expiry, forcing
 * someone to transcribe six digits by hand is a reliable way to fail a login.
 */
const OneTimeCodeInput = forwardRef<HTMLInputElement, OneTimeCodeInputProps>(function OneTimeCodeInput(
  {
    value,
    onChange,
    allowRecoveryCode = false,
    id = 'one-time-code',
    disabled = false,
    autoFocus = false,
    placeholder = '123456',
    ...aria
  },
  ref,
) {
  /**
   * Strip what could never be part of a code, and stop there.
   *
   * Nothing is reformatted as the user types: inserting characters under the
   * cursor is how a paste ends up scrambled, and it fights screen readers
   * announcing the field.
   */
  const clean = (raw: string): string => {
    const stripped = allowRecoveryCode
      ? raw.replace(/[^0-9a-zA-Z-]/g, '').toUpperCase()
      : raw.replace(/\D/g, '');

    return stripped.slice(0, allowRecoveryCode ? 32 : 6);
  };

  return (
    <input
      ref={ref}
      id={id}
      name="one-time-code"
      type="text"
      value={value}
      onChange={(event) => onChange(clean(event.target.value))}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={placeholder}
      autoComplete="one-time-code"
      inputMode={allowRecoveryCode ? 'text' : 'numeric'}
      // Hints the numeric keypad on older mobile browsers that ignore
      // inputMode. Not used for validation — the server decides.
      pattern={allowRecoveryCode ? undefined : '[0-9]*'}
      autoCorrect="off"
      autoCapitalize={allowRecoveryCode ? 'characters' : 'off'}
      spellCheck={false}
      maxLength={allowRecoveryCode ? 32 : 6}
      className="w-full rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--surface-card)] px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] text-[color:var(--text-primary)] placeholder:tracking-normal placeholder:font-sans placeholder:text-base placeholder:text-[color:var(--text-secondary)] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[color:var(--ring)] disabled:opacity-60"
      {...aria}
    />
  );
});

export default OneTimeCodeInput;
