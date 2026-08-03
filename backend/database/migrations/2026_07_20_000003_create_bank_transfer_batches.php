<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // SUPERSEDED: bank_transfer_batches is owned by
        // 2026_06_11_000008_create_bank_integration_tables, which defines the
        // same (canonical) schema and is referenced by bank_transfer_items.
        // Guarded so this migration is inert instead of aborting the run.
        if (Schema::hasTable('bank_transfer_batches')) {
            return;
        }

        Schema::create('bank_transfer_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_run_id')->constrained('payroll_monthly_runs')->cascadeOnDelete();
            $table->string('batch_name', 255);
            $table->string('bank_name', 255);
            $table->decimal('total_amount', 14, 2)->default(0);
            $table->integer('total_employees')->default(0);
            $table->string('status', 20)->default('pending');
            $table->string('file_path', 255)->nullable();
            $table->timestamp('processed_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'payroll_run_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bank_transfer_batches');
    }
};
