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
        if ($account === null) {
            return false;
        }

        if (blank($this->accountNumber($account))) {
            return false;
        }

        return preg_match(self::IFSC_PATTERN, $this->ifsc($account)) === 1;
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
}
