<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_filings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('type'); // pf_ecr, esi_challan, esi_return, form_24q, form_26q, form_16, form_12ba, pt_return, lwf_return, bonus_form_c, bonus_form_d
            $table->string('period_type'); // monthly, quarterly, annual
            $table->string('period_month')->nullable();
            $table->string('period_quarter')->nullable();
            $table->year('period_year');
            $table->string('status')->default('draft'); // draft, generated, filed, acknowledged, error
            $table->string('file_path')->nullable();
            $table->string('original_filename')->nullable();
            $table->string('acknowledgment_number')->nullable();
            $table->timestamp('generated_at')->nullable();
            $table->timestamp('filed_at')->nullable();
            $table->timestamp('acknowledged_at')->nullable();
            $table->foreignId('generated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('filed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->json('meta_data')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'type', 'period_year', 'period_month']);
            $table->index(['organization_id', 'type', 'period_year', 'period_quarter']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_filings');
    }
};
