<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PayrollMonthlyRun;
use App\Services\Payroll\AccountingExportService;
use App\Services\Payroll\PayrollJournalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use RuntimeException;

/**
 * Payroll, as something an accountant can import.
 *
 * The preview is separate from the download on purpose. Somebody about to post
 * half a million rupees into a general ledger should be able to see the journal
 * first, including which components have no ledger mapped — finding that out
 * from a rejected import is a worse afternoon than finding it out here.
 */
class AccountingExportController extends Controller
{
    public function __construct(
        private readonly PayrollJournalService $journals,
        private readonly AccountingExportService $exports,
    ) {
    }

    /** The journal, whether or not it is exportable. */
    public function preview(Request $request, PayrollMonthlyRun $payrollMonthlyRun): JsonResponse
    {
        if (! $this->owns($request, $payrollMonthlyRun->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $journal = $this->journals->build($payrollMonthlyRun);

        return response()->json([
            'data' => $journal,
            // Both reasons it might not be exportable, stated separately so the
            // UI can say which.
            'exportable' => $journal['unmapped'] === []
                && $journal['lines'] !== []
                && $journal['totals']['balanced'],
        ]);
    }

    public function download(Request $request, PayrollMonthlyRun $payrollMonthlyRun): Response|JsonResponse
    {
        if (! $this->owns($request, $payrollMonthlyRun->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate(['format' => 'required|in:tally,zoho']);

        try {
            $tally = $validated['format'] === 'tally';

            $body = $tally
                ? $this->exports->toTallyXml($payrollMonthlyRun)
                : $this->exports->toZohoCsv($payrollMonthlyRun);
        } catch (RuntimeException $exception) {
            // An unmapped ledger or an imbalance. Both are things the caller
            // can fix, so they come back as a message rather than a 500.
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        $period = str_replace('-', '', (string) $payrollMonthlyRun->month_year);
        $name = $tally ? "payroll-{$period}-tally.xml" : "payroll-{$period}-zoho.csv";

        return response($body, 200, [
            'Content-Type' => $tally ? 'application/xml' : 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$name.'"',
        ]);
    }

    private function owns(Request $request, ?int $organizationId): bool
    {
        return (int) $organizationId === (int) $request->user()->organization_id;
    }
}
