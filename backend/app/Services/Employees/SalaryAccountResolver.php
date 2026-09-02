<?php

namespace App\Services\Employees;

use App\Models\EmployeeBankAccount;
use App\Models\User;

/**
 * Which account salary would go to, and whether a bank would accept it.
 *
 * Extracted because two callers now need the same answer and neither is
 * entitled to its own version of it. `PayrollReadinessService` asks so it can
 * warn on day −7 that a run will not clear; the onboarding checklist asks so
 * "Add bank account details" can complete itself. If those two ever disagree,
 * the checklist says the bank details are done and payroll says the person
 * cannot be paid — which is precisely the contradiction the checklist exists to
 * prevent.
 *
 * The IFSC test in particular is not a formality. A malformed code is not
 * rejected by us, it is rejected by the bank, after the batch has gone out.
 */
class SalaryAccountResolver
{
    /** RBI format: four letters, a literal zero, then six alphanumerics. */
    private const IFSC_PATTERN = '/^[A-Z]{4}0[A-Z0-9]{6}$/';

    /**
     * The range Indian bank account numbers actually fall in.
     *
     * Nine is the shortest any scheduled bank issues and eighteen the longest
     * NPCI's bulk formats carry, so anything outside it is a typo or a
     * placeholder rather than an account. The bank cannot tell the difference
     * either — it just rejects the line, after the batch has gone out.
     */
    private const ACCOUNT_MIN_DIGITS = 9;
    private const ACCOUNT_MAX_DIGITS = 18;

    /**
     * The account salary is paid into.
     *
     * Read off the loaded relation rather than re-queried, so a caller that has
     * eager-loaded `employeeBankAccounts` for a page of people does not pay for
     * one query per person. Falls back to the only account on file when nobody
     * has flagged a default — a single unflagged account is plainly the one
     * they meant, and reporting it as missing helps nobody.
     */
    public function defaultFor(User $user): ?EmployeeBankAccount
    {
        $accounts = $user->employeeBankAccounts;

        return $accounts->firstWhere('is_default', true) ?? $accounts->first();
    }

    /** Is there an account number, and an IFSC a bank would actually accept? */
    public function isPayable(?EmployeeBankAccount $account): bool
    {
        return $this->problemWith($account) === null;
    }

    /**
     * Why a bank would reject this line, in a sentence somebody can act on, or
     * null when it would not.
     *
     * Returned as prose rather than a boolean because both callers have to show
     * it: the readiness screen tells an admin what to fix before the run, and
     * disbursement names it as an exclusion afterwards. "Not payable" sends
     * somebody to look at a record that appears complete.
     */
    public function problemWith(?EmployeeBankAccount $account): ?string
    {
        if ($account === null) {
            return 'No bank account on record.';
        }

        $digits = $this->accountDigits($account);
        $raw = $this->accountNumber($account);

        if ($digits === '') {
            return blank($raw)
                ? 'Bank account is missing an account number.'
                : sprintf('"%s" is not a valid account number — it contains no digits.', $raw);
        }

        if (strlen($digits) < self::ACCOUNT_MIN_DIGITS || strlen($digits) > self::ACCOUNT_MAX_DIGITS) {
            return sprintf(
                'Account number is %d digits. A bank account number is between %d and %d.',
                strlen($digits),
                self::ACCOUNT_MIN_DIGITS,
                self::ACCOUNT_MAX_DIGITS
            );
        }

        /*
         * A number of one repeated digit is what somebody types to get past a
         * required field. It is syntactically fine and reaches the bank as a
         * real instruction, which is the whole reason to catch it here.
         */
        if (preg_match('/^(\d)\1+$/', $digits) === 1) {
            return sprintf('"%s" is not a real account number — it is a single repeated digit.', $digits);
        }

        // Letters mean somebody has pasted an IBAN or a reference into the
        // wrong field. Stripping them and paying the remainder would send the
        // money somewhere; refusing is the only safe reading.
        if (preg_match('/[^0-9]/', $raw) === 1 && preg_match('/^[0-9\s-]+$/', $raw) !== 1) {
            return sprintf('"%s" is not a valid account number — it contains letters or symbols.', $raw);
        }

        $ifsc = $this->ifsc($account);

        if ($ifsc === '') {
            return 'Bank account is missing an IFSC.';
        }

        if (preg_match(self::IFSC_PATTERN, $ifsc) !== 1) {
            return sprintf(
                '"%s" is not a valid IFSC. It must be eleven characters: four letters, a zero, then six more.',
                $ifsc
            );
        }

        return null;
    }

    /**
     * The name the bank file carries, or null when there is none to carry.
     *
     * The account holder's name wins over the login name: the two legitimately
     * differ, and the bank matches against the holder.
     */
    public function beneficiaryName(?EmployeeBankAccount $account, ?User $user = null): ?string
    {
        $name = trim((string) ($account?->account_holder_name ?? ''));

        if ($name === '') {
            $name = trim((string) ($user?->name ?? ''));
        }

        return $name !== '' ? $name : null;
    }

    /**
     * How to name this account to a reader.
     *
     * Masked to the last four digits. This renders on an admin panel beside a
     * completed checklist item, where the point is to say WHICH account
     * satisfied it — the full number answers nothing that the last four do not
     * and puts it on a screen that did not need it.
     */
    public function label(?EmployeeBankAccount $account): ?string
    {
        if ($account === null) {
            return null;
        }

        $number = $this->accountNumber($account);
        $bank = trim((string) ($account->bank_name ?? ''));
        $masked = str_repeat('•', max(0, strlen($number) - 4)).substr($number, -4);

        return $bank !== ''
            ? $bank.' · '.$masked
            : 'Bank account · '.$masked;
    }

    /**
     * The column is `ifsc_swift` — an IFSC for domestic accounts, a SWIFT code
     * for foreign ones.
     */
    public function ifsc(EmployeeBankAccount $account): string
    {
        return strtoupper(trim((string) ($account->ifsc_swift ?? '')));
    }

    public function accountNumber(EmployeeBankAccount $account): string
    {
        return (string) preg_replace('/\s+/', '', (string) ($account->account_number ?? ''));
    }

    /**
     * The account number as a bank file carries it: digits only.
     *
     * Passbooks and cheque leaves print separators, and people type them in.
     * Stripping them is not a correction — the digits are the account number —
     * so it happens before any judgement about length is made, or a perfectly
     * good "5010-0123 456789" is rejected for being sixteen characters.
     */
    public function accountDigits(EmployeeBankAccount $account): string
    {
        return (string) preg_replace('/\D+/', '', (string) ($account->account_number ?? ''));
    }
}
