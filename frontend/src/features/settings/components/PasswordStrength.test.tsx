import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PasswordStrength, { evaluatePassword } from './PasswordStrength';

/**
 * The one place in the app that names the password rules.
 *
 * It used to be rendered on exactly one screen — Settings → change password —
 * while accept-invite, reset-password and owner-signup showed a bare box. So
 * somebody setting their very first password learned the policy by being
 * refused. It renders on all four now, which makes what it claims load-bearing:
 * if this drifts from the server rule, every one of those screens lies.
 */
describe('PasswordStrength', () => {
  it('accepts eight characters, matching the server minimum', () => {
    // The server enforces min(8). If somebody raises it back to 12, this fails
    // rather than the UI quietly promising something untrue on four screens.
    expect(evaluatePassword('Abcd12!x').checks.length).toBe(true);
    expect(evaluatePassword('Abcd12!').checks.length).toBe(false);
  });

  it('scores a fully compliant password as meeting every visible rule', () => {
    const { checks, score } = evaluatePassword('Abcd12!x');

    expect(checks).toEqual({ length: true, caseMix: true, number: true, symbol: true });
    expect(score).toBe(4);
  });

  it('fails each composition rule independently', () => {
    // Mirrors PasswordPolicyTest on the backend: same four rules, same cases.
    expect(evaluatePassword('abcd1234!').checks.caseMix).toBe(false);
    expect(evaluatePassword('Abcdefg!').checks.number).toBe(false);
    expect(evaluatePassword('Abcd1234').checks.symbol).toBe(false);
  });

  it('lists every requirement so they are known before submitting', () => {
    render(<PasswordStrength value="" />);

    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/upper and lower case/i)).toBeInTheDocument();
    expect(screen.getByText(/a number/i)).toBeInTheDocument();
    expect(screen.getByText(/a symbol/i)).toBeInTheDocument();
  });

  it('mentions the breach check as a note rather than a tick', () => {
    /*
     * It cannot be evaluated in the browser — it is a server-side k-anonymity
     * lookup — so a fifth checkbox would never go green and would read as a rule
     * you have failed. But saying nothing is worse: a password meeting all four
     * visible rules can still be refused, which is the rejection that confused
     * people most.
     */
    render(<PasswordStrength value="Abcd12!x" />);

    expect(screen.getByText(/checked against known data breaches/i)).toBeInTheDocument();
    // Four ticks, not five.
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });
});
