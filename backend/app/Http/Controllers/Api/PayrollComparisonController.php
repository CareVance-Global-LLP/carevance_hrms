<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PayrollMonthlyRun;
use App\Services\Payroll\PayrollComparisonService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The four detective reports, over one diff primitive.
 *
 * Read-only by construction: these exist to be run on the months you can no
 * longer change, so a report that needed the run open would be useless exactly
 * when it matters.
 *
 * Deliberately not gated on run status. A disbursed month is the most useful
 * thing to compare against, and refusing to read it would reproduce the problem
 * these reports were built to solve.
 */
class PayrollComparisonController extends Controller
{
    public function __construct(private readonly PayrollComparisonService $comparison)
    {
    }

    /**
     * Payroll Differences, in whichever of its three presentations was asked
     * for. One endpoint rather than three because they are three views of one
     * comparison, not three reports.
     */
    public function differences(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from_month' => 'required|string|date_format:Y-m',
            'to_month' => 'required|string|date_format:Y-m',
            'view' => 'nullable|in:item_wise,employee_wise,consolidated',
        ]);

        [$from, $to] = $this->resolvePair($data['from_month'], $data['to_month']);

        if (! $from || ! $to) {
            return $this->missingRun($data['from_month'], $data['to_month'], $from, $to);
        }

        $view = $data['view'] ?? 'employee_wise';

        return response()->json([
            'success' => true,
            'from_month' => $data['from_month'],
            'to_month' => $data['to_month'],
            'view' => $view,
            'data' => match ($view) {
                'item_wise' => $this->comparison->itemWise($from, $to),
                'consolidated' => $this->comparison->consolidated($from, $to),
                default => $this->comparison->employeeWise($from, $to),
            },
        ]);
    }

    public function negativeCost(Request $request): JsonResponse
    {
        $data = $request->validate(['month' => 'required|string|date_format:Y-m']);

        $run = $this->runFor($data['month']);
        if (! $run) {
            return $this->noRun($data['month']);
        }

        $findings = $this->comparison->negativeCost($run);

        return response()->json([
            'success' => true,
            'month' => $data['month'],
            // Split so a caller can block on defects while merely surfacing
            // the reviews — a negative net pay is a real outcome that needs a
            // human, a negative earning is broken.
            'defects' => array_values(array_filter($findings, fn ($f) => $f['severity'] === 'defect')),
            'reviews' => array_values(array_filter($findings, fn ($f) => $f['severity'] === 'review')),
        ]);
    }

    public function duplicates(Request $request): JsonResponse
    {
        $data = $request->validate(['month' => 'required|string|date_format:Y-m']);

        $run = $this->runFor($data['month']);
        if (! $run) {
            return $this->noRun($data['month']);
        }

        return response()->json([
            'success' => true,
            'month' => $data['month'],
            'data' => $this->comparison->duplicates($run),
        ]);
    }

    public function reconciliation(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from_month' => 'required|string|date_format:Y-m',
            'to_month' => 'required|string|date_format:Y-m',
        ]);

        [$from, $to] = $this->resolvePair($data['from_month'], $data['to_month']);

        if (! $from || ! $to) {
            return $this->missingRun($data['from_month'], $data['to_month'], $from, $to);
        }

        return response()->json([
            'success' => true,
            'data' => $this->comparison->reconciliation($from, $to),
        ]);
    }

    /**
     * The organization scope is applied by BelongsToOrganization, so this
     * cannot reach another tenant's run.
     */
    private function runFor(string $monthYear): ?PayrollMonthlyRun
    {
        return PayrollMonthlyRun::where('month_year', $monthYear)->first();
    }

    /** @return array{0: ?PayrollMonthlyRun, 1: ?PayrollMonthlyRun} */
    private function resolvePair(string $fromMonth, string $toMonth): array
    {
        return [$this->runFor($fromMonth), $this->runFor($toMonth)];
    }

    private function noRun(string $monthYear): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => "No payroll run exists for {$monthYear}.",
        ], 404);
    }

    /**
     * Name which side is missing. "One of these months has no run" sends the
     * caller to check both.
     */
    private function missingRun(
        string $fromMonth,
        string $toMonth,
        ?PayrollMonthlyRun $from,
        ?PayrollMonthlyRun $to
    ): JsonResponse {
        $missing = [];
        if (! $from) {
            $missing[] = $fromMonth;
        }
        if (! $to) {
            $missing[] = $toMonth;
        }

        return response()->json([
            'success' => false,
            'message' => 'No payroll run exists for '.implode(' or ', $missing).'.',
        ], 404);
    }
}
