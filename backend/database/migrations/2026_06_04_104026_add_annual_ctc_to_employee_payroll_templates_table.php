<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            $table->decimal('annual_ctc', 15, 2)->nullable()->default(null)->after('special_allowance');
        });
    }

    public function down(): void
    {
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            $table->dropColumn('annual_ctc');
        });
    }
};
