<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('payslip_ytd_history', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('pay_month');
            $table->unsignedSmallInteger('pay_year');
            $table->decimal('gross', 12, 2)->default(0);
            $table->decimal('deductions', 12, 2)->default(0);
            $table->decimal('net', 12, 2)->default(0);
            $table->decimal('pf_ee', 12, 2)->default(0);
            $table->decimal('esi_ee', 12, 2)->default(0);
            $table->decimal('pt', 12, 2)->default(0);
            $table->decimal('lwf', 12, 2)->default(0);
            $table->timestamps();

            $table->unique(['employee_id', 'pay_month', 'pay_year'], 'unique_ytd');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('payslip_ytd_history');
    }
};
