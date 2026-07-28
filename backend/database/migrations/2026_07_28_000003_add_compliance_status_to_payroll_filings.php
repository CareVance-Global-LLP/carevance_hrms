<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_filings', function (Blueprint $table) {
            $table->string('compliance_status', 32)->default('not_configured')->after('status')->index();
        });
    }

    public function down(): void
    {
        Schema::table('payroll_filings', function (Blueprint $table) {
            $table->dropColumn('compliance_status');
        });
    }
};
