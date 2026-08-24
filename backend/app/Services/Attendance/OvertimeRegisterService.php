<?php

namespace App\Services\Attendance;

use App\Models\AttendanceRecord;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Collection;

/**
 * The overtime register.
 *
 * A statutory record, not a report. Section 59(4) of the Factories Act requires
 * a register of overtime showing what was worked and what was paid for it, and
 * an inspector asks for it by name — which is why the columns here are the
 * statutory ones (worker, date, normal hours, overtime hours, rate, amount)
 * rather than whatever the dashboard happened to have.
 *
 * THE AMOUNT IS NULL WHEN IT CANNOT BE COMPUTED, never zero. An employee with
 * no ordinary rate on their payroll template produces overtime hours with no
 * money against them, and a register showing 0.00 reads as "overtime worked,
 * nothing owed" — the opposite of what is true. Null reads as "not computed",
 * and the caller can see how many rows are in that state.
 *
 * PENDING HOURS ARE SHOWN, NOT HIDDEN. Where the policy requires approval,
 * unapproved overtime appears in its own column. It was still worked, the
 * statutory limits still count it, and a register that silently omits it
 * understates what the establishment actually asked of people.
 */
class OvertimeRegisterService
{
    public function __construct(
        private readonly OvertimeEngine $overtime,
        private readonly StatutoryWorkingTime $statute,
    ) {
    }

    /**
     * @param  Collection<int, User>  $users
     * @return array{
     *   from: string, to: string,
     *   rows: array<int, array<string, mixed>>,
     *   totals: array<string, mixed>,
     * }
     */
    public function build(Collection $users, Carbon|string $from, Carbon|string $to): array
    {
        $start = Carbon::parse((string) $from)->startOfDay();
        $end = Carbon::parse((string) $to)->startOfDay();

        $rows = [];
        $totalOvertime = 0;
        $totalPending = 0;
        $unpriced = 0;

        foreach ($users as $user) {
            $records = AttendanceRecord::query()
                ->where('user_id', $user->id)
                ->whereDate('attendance_date', '>=', $start->toDateString())
                ->whereDate('attendance_date', '<=', $end->toDateString())
                ->orderBy('attendance_date')
                ->get();

            $hourlyRate = $this->hourlyRateFor($user);
            $limits = $this->statute->forUser($user);

            foreach ($records as $record) {
                $minutes = intdiv(max(0, (int) $record->worked_seconds), 60);

                $assessment = $this->overtime->evaluate(
                    user: $user,
                    date: $record->attendance_date,
                    grossMinutes: $minutes,
                    effectiveMinutes: $minutes,
                    approved: true,
                );

                // Assessed a second time WITHOUT the approval override, so the
                // register can separate what is payable from what is merely
                // worked. Cheap: both reads hit the same warm policy rows.
                $asRecorded = $this->overtime->evaluate(
                    user: $user,
                    date: $record->attendance_date,
                    grossMinutes: $minutes,
                    effectiveMinutes: $minutes,
                    approved: false,
                );

                if ($assessment->roundedMinutes <= 0) {
                    continue;
                }

                /*
                 * Priced off the ASSESSED hours, not the approved ones.
                 *
                 * An employer's approval workflow is internal; the register
                 * records what was worked and what that work is worth. Pricing
                 * the unapproved assessment instead returns 0.00 for every
                 * pending row - which is precisely the "overtime worked,
                 * nothing owed" reading this class exists to avoid, arrived at
                 * from the other direction. What has and has not been approved
                 * is carried in the payable and pending columns, where it can
                 * be read as the workflow state it is.
                 */
                $amount = $hourlyRate !== null
                    ? $assessment->amountForHourlyRate($hourlyRate)
                    : null;

                if ($amount === null) {
                    $unpriced++;
                }

                $totalOvertime += $assessment->roundedMinutes;
                $totalPending += $asRecorded->pendingMinutes();

                $rows[] = [
                    'user_id' => (int) $user->id,
                    'name' => (string) $user->name,
                    'employee_code' => $user->employeeWorkInfo?->employee_code,
                    'date' => Carbon::parse($record->attendance_date)->toDateString(),
                    'scope' => $assessment->scope,
                    'normal_minutes' => $assessment->expectedMinutes,
                    'worked_minutes' => $assessment->workedMinutes,
                    'overtime_minutes' => $assessment->roundedMinutes,
                    'payable_minutes' => $asRecorded->payableMinutes(),
                    'pending_minutes' => $asRecorded->pendingMinutes(),
                    'multiplier' => $assessment->multiplier,
                    'configured_multiplier' => $assessment->configuredMultiplier ?? $assessment->multiplier,
                    'statutory_multiplier_floor' => $assessment->statutoryMultiplierFloor,
                    'is_below_statutory_floor' => $assessment->isBelowStatutoryFloor(),
                    'hourly_rate' => $hourlyRate,
                    // Null, never 0.00 — see the class docblock.
                    'amount' => $amount,
                    'establishment_type' => $limits->establishmentType,
                ];
            }
        }

        return [
            'from' => $start->toDateString(),
            'to' => $end->toDateString(),
            'rows' => $rows,
            'totals' => [
                'entries' => count($rows),
                'overtime_minutes' => $totalOvertime,
                'pending_minutes' => $totalPending,
                // Surfaced rather than buried: a register that cannot price
                // half its rows is not a register anybody should hand over.
                'rows_without_a_rate' => $unpriced,
            ],
        ];
    }

    /**
     * The ordinary hourly rate, from the same annual CTC payroll computes on.
     *
     * Null when there is no template, because there is then no ordinary rate to
     * be twice OF. Guessing one from a shift length and a stray salary field
     * would produce an overtime amount that does not reconcile with the payslip
     * — and the register is the document that gets compared against it.
     */
    private function hourlyRateFor(User $user): ?string
    {
        $annual = $user->employeePayrollTemplate?->annual_ctc;

        if ($annual === null || (float) $annual <= 0) {
            return null;
        }

        // Monthly gross over the statutory 26-day month and 8 ordinary hours,
        // the convention Indian overtime is computed on.
        $monthly = bcdiv((string) $annual, '12', 8);

        return bcdiv(bcdiv($monthly, '26', 8), '8', 6);
    }
}
