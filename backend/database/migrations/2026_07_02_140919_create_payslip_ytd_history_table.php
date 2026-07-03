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
            $table->unsignedBigInteger('employee_id');
            $table->integer('pay_month');
            $table->integer('pay_year');
            $table->decimal('gross', 14, 2)->default(0);
            $table->decimal('deductions', 14, 2)->default(0);
            $table->decimal('net', 14, 2)->default(0);
            $table->decimal('pf_ee', 10, 2)->default(0);
            $table->decimal('esi_ee', 10, 2)->default(0);
            $table->decimal('pt', 10, 2)->default(0);
            $table->decimal('lwf', 10, 2)->default(0);
            $table->timestamps();

            $table->unique(['employee_id', 'pay_month', 'pay_year']);
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
