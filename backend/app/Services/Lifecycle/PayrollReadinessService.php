<?php

namespace App\Services\Lifecycle;

use App\Models\EmployeeSalaryAssignment;
use App\Models\User;
use Illuminate\Support\Facades\Schema;

/**
 * Answers one question about a person: would payroll actually pay them?
 *
 * Onboarding checklists everywhere — ours included, and Keka's — close an item
 * when a human ticks it. "Upload PAN card ✓" means somebody attested that a
 * file arrived. It does not mean the PAN is well-formed, that it is not already
 * on another employee, or that the first salary run will clear.
 *
 * That gap is where the cost sits: the problem is found on payday, when the
 * money was supposed to move, instead of during onboarding when there was still
 * time. This service closes it by checking the same facts payroll itself
 * depends on, so "will this person be paid on the 1st?" is answerable on day −7.
 *
 * Every check is read-only and derived. Nothing here is stored, so it cannot
 * drift out of date the way a ticked checkbox does.
 */
class PayrollReadinessService
{
    /** Blocks the first salary run outright. */
    public const SEVERITY_BLOCKER = 'blocker';

    /** Pays, but something downstream (a filing, a deduction) will be wrong. */
    public const SEVERITY_WARNING = 'warning';

    /**
     * @return array{
     *   ready: bool,
     *   score: int,
     *   checks: array<int, array{key: string, label: string, passed: bool, severity: string, detail: string}>,
     *   blockers: int,
     *   warnings: int,
     * }
     */
    public function evaluate(User $user): array
    {
        $checks = [
            $this->checkPan($user),
            $this->checkBankAccount($user),
            $this->checkSalaryStructure($user),
            $this->checkJoiningDate($user),
            $this->checkUan($user),
            $this->checkProfessionalTaxState($user),
        ];

        $blockers = collect($checks)
            ->filter(fn ($c) => ! $c['passed'] && $c['severity'] === self::SEVERITY_BLOCKER)
            ->count();

        $warnings = collect($checks)
            ->filter(fn ($c) => ! $c['passed'] && $c['severity'] === self::SEVERITY_WARNING)
            ->count();

        $passed = collect($checks)->filter(fn ($c) => $c['passed'])->count();

        return [
            'ready' => $blockers === 0,
            'score' => (int) round(($passed / max(1, count($checks))) * 100),
            'checks' => $checks,
            'blockers' => $blockers,
            'warnings' => $warnings,
        ];
    }

    /**
     * PAN drives TDS and Form 24Q. A missing or malformed one makes the filing
     * emit PANINVALID, which the department rejects — so this is a blocker even
     * though salary would technically still move.
     */
    private function checkPan(User $user): array
    {
        $pan = $user->statutoryId('pan');

        if (blank($pan)) {
            return $this->fail('pan', 'PAN on file', self::SEVERITY_BLOCKER, 'No PAN recorded. Form 24Q will be rejected.');
        }

        $normalised = strtoupper(trim($pan));

        if (! preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/', $normalised)) {
            return $this->fail(
                'pan',
                'PAN on file',
                self::SEVERITY_BLOCKER,
                sprintf('"%s" is not a valid PAN. Expected five letters, four digits, one letter.', $normalised),
            );
        }

        // The same PAN on two people means one of them is wrong, and TDS will be
        // filed against the wrong person for the whole year.
        //
        // Checked only employee_profiles.pan_number, which is NULL in all 86
        // rows on the live database — PANs live in employee_government_ids, and
        // statutoryId() reads that as its fallback. So the duplicate check could
        // never fire. Search both homes, the same two this resolves from.
        $duplicate = User::query()
            ->where('id', '!=', $user->id)
            ->where('organization_id', $user->organization_id)
            ->where(function ($query) use ($normalised) {
                $query
                    ->whereHas('employeeProfile', fn ($q) => $q->whereRaw('UPPER(pan_number) = ?', [$normalised]))
                    ->orWhereHas('employeeGovernmentIds', fn ($q) => $q
                        ->whereRaw('LOWER(id_type) LIKE ?', ['%pan%'])
                        ->whereRaw('UPPER(TRIM(id_number)) = ?', [$normalised]));
            })
            ->exists();

        if ($duplicate) {
            return $this->fail('pan', 'PAN on file', self::SEVERITY_BLOCKER, 'This PAN is already recorded against another employee.');
        }

        return $this->pass('pan', 'PAN on file', $normalised);
    }

    /**
     * Mirrors what PayrollDisbursementService needs to write a NEFT line. If
     * these are absent the person is silently excluded from the bank file.
     */
    private function checkBankAccount(User $user): array
    {
        $account = $this->defaultBankAccount($user);

        if ($account === null) {
            return $this->fail('bank', 'Bank account for salary', self::SEVERITY_BLOCKER, 'No bank account on file — they cannot be included in a bank transfer batch.');
        }

        // The column is ifsc_swift — it holds an IFSC for domestic accounts and
        // a SWIFT code for foreign ones.
        $ifsc = strtoupper(trim((string) ($account->ifsc_swift ?? '')));
        $number = preg_replace('/\s+/', '', (string) ($account->account_number ?? ''));

        if (blank($number)) {
            return $this->fail('bank', 'Bank account for salary', self::SEVERITY_BLOCKER, 'Account number is missing.');
        }

        // RBI IFSC: four letters, a literal 0, then six alphanumerics.
        if (! preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', $ifsc)) {
            return $this->fail(
                'bank',
                'Bank account for salary',
                self::SEVERITY_BLOCKER,
                sprintf('"%s" is not a valid IFSC. The transfer will be rejected by the bank.', $ifsc !== '' ? $ifsc : '(empty)'),
            );
        }

        return $this->pass('bank', 'Bank account for salary', $ifsc.' · '.str_repeat('•', max(0, strlen($number) - 4)).substr($number, -4));
    }

    /** Without a structure there is no gross to calculate, so nothing to pay. */
    private function checkSalaryStructure(User $user): array
    {
        if (! Schema::hasTable('employee_salary_assignments')) {
            return $this->pass('salary', 'Salary structure assigned', 'Not tracked in this deployment');
        }

        $assigned = EmployeeSalaryAssignment::query()
            ->where('user_id', $user->id)
            ->exists();

        return $assigned
            ? $this->pass('salary', 'Salary structure assigned', 'Assigned')
            : $this->fail('salary', 'Salary structure assigned', self::SEVERITY_BLOCKER, 'No salary structure — payroll has no gross to calculate.');
    }

    /** Proration for a mid-month joiner is computed from this date. */
    private function checkJoiningDate(User $user): array
    {
        $joining = $user->employeeWorkInfo?->joining_date;

        return filled($joining)
            ? $this->pass('joining_date', 'Joining date recorded', $joining->format('d M Y'))
            : $this->fail('joining_date', 'Joining date recorded', self::SEVERITY_BLOCKER, 'Without a joining date a mid-month salary cannot be prorated.');
    }

    /**
     * A warning, not a blocker: salary still moves without a UAN, but the PF
     * ECR cannot be filed for them and the contribution goes unallocated.
     */
    private function checkUan(User $user): array
    {
        $uan = $user->statutoryId('uan');

        if (blank($uan)) {
            return $this->fail('uan', 'UAN for PF filing', self::SEVERITY_WARNING, 'No UAN — this employee will be missing from the PF ECR.');
        }

        if (! preg_match('/^\d{12}$/', preg_replace('/\D/', '', $uan))) {
            return $this->fail('uan', 'UAN for PF filing', self::SEVERITY_WARNING, sprintf('"%s" is not a 12-digit UAN.', $uan));
        }

        return $this->pass('uan', 'UAN for PF filing', $uan);
    }

    /**
     * Professional tax is state-levied and several states levy none, so an
     * unset state is not automatically wrong — but it does mean PT resolves to
     * zero, and that should be a deliberate choice rather than a blank field.
     */
    private function checkProfessionalTaxState(User $user): array
    {
        $state = $user->organization?->pt_state;

        return filled($state)
            ? $this->pass('pt_state', 'Professional tax state set', (string) $state)
            : $this->fail(
                'pt_state',
                'Professional tax state set',
                self::SEVERITY_WARNING,
                'No PT state on the organisation, so professional tax will compute as ₹0 for everyone.',
            );
    }

    private function defaultBankAccount(User $user): ?object
    {
        $accounts = $user->employeeBankAccounts()->get();

        // Salary goes to the default account; fall back to the only one on file
        // so a single unflagged account is not reported as missing.
        return $accounts->firstWhere('is_default', true) ?? $accounts->first();
    }

    private function pass(string $key, string $label, string $detail): array
    {
        return ['key' => $key, 'label' => $label, 'passed' => true, 'severity' => self::SEVERITY_BLOCKER, 'detail' => $detail];
    }

    private function fail(string $key, string $label, string $severity, string $detail): array
    {
        return ['key' => $key, 'label' => $label, 'passed' => false, 'severity' => $severity, 'detail' => $detail];
    }
}
