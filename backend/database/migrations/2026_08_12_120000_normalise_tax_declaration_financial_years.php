<?php

use App\Services\PayrollCalculatorService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Collapse employee_tax_declarations.financial_year onto one canonical shape.
 *
 * The column was found holding four spellings of the same concept:
 *
 *     2025-26      84 rows
 *     2026-2027    15 rows
 *     2026          2 rows
 *     2026-27       1 row
 *
 * PayrollCalculatorService looks declarations up with an exact string match on
 * 'YYYY-YY', so 17 of those 102 rows were unreachable. An approved declaration
 * that cannot be found contributes no exemptions at all and the employee is
 * taxed as though they had declared nothing — roughly ₹46,000 a year of excess
 * TDS on a full 80C plus 80D claim.
 *
 * None of the mismatched rows were approved when this was written, so the loss
 * was latent rather than realised. It became real the moment anyone approved
 * one.
 *
 * EmployeeTaxDeclaration::setFinancialYearAttribute() keeps new writes
 * canonical; this repairs what is already there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('employee_tax_declarations')) {
            return;
        }

        $rows = DB::table('employee_tax_declarations')
            ->select('financial_year')
            ->distinct()
            ->pluck('financial_year');

        foreach ($rows as $stored) {
            if ($stored === null || $stored === '') {
                continue;
            }

            $canonical = PayrollCalculatorService::financialYearKey((string) $stored);

            if ($canonical === $stored) {
                continue;
            }

            /*
             * A user may hold rows under two spellings of the same year — for
             * example '2026' and '2026-27'. Rewriting blindly would collide if
             * a unique index on (user_id, financial_year) exists, and would
             * leave two rows for one year if it does not. Neither is
             * acceptable, so only rows whose canonical form is not already
             * taken by that user are rewritten; the rest are left alone for a
             * human to merge, because picking which declaration wins is not a
             * migration's decision to make.
             */
            DB::table('employee_tax_declarations as d')
                ->where('d.financial_year', $stored)
                ->whereNotExists(function ($q) use ($canonical) {
                    $q->select(DB::raw(1))
                        ->from('employee_tax_declarations as other')
                        ->whereColumn('other.user_id', 'd.user_id')
                        ->where('other.financial_year', $canonical);
                })
                ->update(['financial_year' => $canonical]);
        }
    }

    public function down(): void
    {
        // Irreversible by design: the original spelling of each row is not
        // recorded anywhere, and restoring a broken key would only re-hide the
        // declarations this migration made reachable.
    }
};
