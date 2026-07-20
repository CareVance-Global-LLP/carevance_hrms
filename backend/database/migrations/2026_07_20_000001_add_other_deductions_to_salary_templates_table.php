<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('salary_templates', function (Blueprint $table) {
            if (!Schema::hasColumn('salary_templates', 'other_deductions')) {
                $table->json('other_deductions')->nullable()->after('other_earnings');
            }
        });
    }

    public function down(): void
    {
        Schema::table('salary_templates', function (Blueprint $table) {
            if (Schema::hasColumn('salary_templates', 'other_deductions')) {
                $table->dropColumn('other_deductions');
            }
        });
    }
};
