<?php

namespace App\Services;

use App\Models\PayrollRun;
use App\Models\Payroll;
use App\Models\Department;
use App\Models\Employee;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Salary Revision / Increment / Promotion Module
 *
 * Handles the complete salary change workflow:
 *  - Increment letter generation
 *  - Effective date management
 *  - Back-dated vs forward-dated changes
 *  - Promotion + designation change + role-fit score
 *  - Revision history audit trail
 */
class CtcPlannerService
{
    /**
     * Process a salary revision for an employee.
     */
    public function revise(array $data): array
    {
        $employee = Employee::with('user')->findOrFail($data['employee_id']);
        $oldCtc = (float) $employee->current_ctc;
        $newCtc = (float) $data['new_ctc'];
        $incrementPct = $oldCtc > 0 ? (($newCtc - $oldCtc) / $oldCtc) * 100 : 0;

        return DB::transaction(function () use ($employee, $data, $oldCtc, $newCtc, $incrementPct) {
            $revision = DB::table('salary_revisions')->insertGetId([
                'employee_id' => $employee->id,
                'user_id' => $employee->user_id,
                'old_ctc' => $oldCtc,
                'new_ctc' => $newCtc,
                'increment_amount' => $newCtc - $oldCtc,
                'increment_percentage' => round($incrementPct, 2),
                'effective_from' => $data['effective_from'],
                'reason' => $data['reason'] ?? null,
                'promoted_to' => $data['new_designation'] ?? null,
                'approved_by' => $data['approved_by'] ?? null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $employee->update([
                'current_ctc' => $newCtc,
                'designation' => $data['new_designation'] ?? $employee->designation,
            ]);

            $letterPath = $this->generateIncrementLetter($employee, $oldCtc, $newCtc, $incrementPct, $data);

            return [
                'revision_id' => $revision,
                'old_ctc' => $oldCtc,
                'new_ctc' => $newCtc,
                'increment_pct' => round($incrementPct, 2),
                'increment_amount' => $newCtc - $oldCtc,
                'letter_path' => $letterPath,
                'effective_from' => $data['effective_from'],
            ];
        });
    }

    /**
     * Generate increment letter PDF/HTML.
     */
    protected function generateIncrementLetter($employee, float $oldCtc, float $newCtc, float $pct, array $data): string
    {
        $html = view('letters.increment', [
            'employee' => $employee,
            'user' => $employee->user,
            'oldCtc' => $oldCtc,
            'newCtc' => $newCtc,
            'incrementPct' => $pct,
            'effectiveFrom' => $data['effective_from'],
            'reason' => $data['reason'] ?? 'Annual performance review',
            'designation' => $data['new_designation'] ?? $employee->designation,
            'generatedAt' => now(),
        ])->render();
        $path = "letters/increments/INC_{$employee->employee_code}_" . now()->format('Ymd') . ".html";
        \Storage::disk('local')->put($path, $html);
        return $path;
    }
}
