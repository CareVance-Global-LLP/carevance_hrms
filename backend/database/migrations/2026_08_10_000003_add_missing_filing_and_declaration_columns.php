<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add columns three models declare, and their tables never had.
 *
 * `PayrollFiling`, `PayrollTaxDeclaration` and `EmployeeTaxDeclarationItem`
 * each list attributes in $fillable that do not exist as columns — fifteen
 * between them. That is not merely untidy: PayrollFilingController assigns
 * several of them directly and calls save(), so the statutory filing review
 * workflow raises "column does not exist" the moment it is exercised. It has
 * never been reachable, which is why nobody noticed.
 *
 * Adding the columns rather than deleting the declarations, because the code
 * that uses them is real and complete — the review flow assigns portal_status,
 * reviewer_user_id and review_note, and the tax declaration flow tracks
 * verification totals and proof submission state.
 *
 * Every column is nullable so existing rows stay valid, and each add is guarded
 * so this is a no-op where a column already exists.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->addColumns('payroll_filings', function (Blueprint $table, callable $missing) {
            // Where the filing stands on the government portal, and who is
            // responsible for getting it there.
            if ($missing('portal_status')) $table->string('portal_status', 32)->nullable();
            if ($missing('submitted_at')) $table->timestamp('submitted_at')->nullable();
            if ($missing('approved_at')) $table->timestamp('approved_at')->nullable();
            if ($missing('submitted_by')) $table->unsignedBigInteger('submitted_by')->nullable();
            if ($missing('approved_by')) $table->unsignedBigInteger('approved_by')->nullable();
            if ($missing('reviewer_user_id')) $table->unsignedBigInteger('reviewer_user_id')->nullable();
            if ($missing('review_note')) $table->text('review_note')->nullable();
        });

        $this->addColumns('payroll_tax_declarations', function (Blueprint $table, callable $missing) {
            // Money, so decimal — never float. 15,2 matches the other amount
            // columns in the payroll schema.
            if ($missing('total_declared_amount')) $table->decimal('total_declared_amount', 15, 2)->nullable();
            if ($missing('total_verified_amount')) $table->decimal('total_verified_amount', 15, 2)->nullable();
            if ($missing('verified_at')) $table->timestamp('verified_at')->nullable();
            if ($missing('verified_by')) $table->unsignedBigInteger('verified_by')->nullable();
            if ($missing('meta')) $table->json('meta')->nullable();
        });

        $this->addColumns('employee_tax_declaration_items', function (Blueprint $table, callable $missing) {
            if ($missing('proof_status')) $table->string('proof_status', 32)->nullable();
            if ($missing('proof_submission_id')) $table->unsignedBigInteger('proof_submission_id')->nullable();
            if ($missing('proof_submitted_at')) $table->timestamp('proof_submitted_at')->nullable();
        });
    }

    public function down(): void
    {
        // Deliberately not reversed. Dropping these would delete filing review
        // history and tax verification state, and the models still declare them
        // — so a rollback would restore the broken condition this repairs.
    }

    /**
     * Apply a column-adding callback to a table, if the table exists, passing a
     * `missing($column)` helper so each add can be guarded individually.
     */
    private function addColumns(string $tableName, callable $definer): void
    {
        if (! Schema::hasTable($tableName)) {
            return;
        }

        $missing = fn (string $column): bool => ! Schema::hasColumn($tableName, $column);

        Schema::table($tableName, function (Blueprint $table) use ($definer, $missing) {
            $definer($table, $missing);
        });
    }
};
