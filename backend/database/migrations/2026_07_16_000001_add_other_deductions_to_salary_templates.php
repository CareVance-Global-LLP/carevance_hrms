<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('salary_templates') && !Schema::hasColumn('salary_templates', 'other_deductions')) {
            Schema::table('salary_templates', function (Blueprint $table) {
                $table->json('other_deductions')->nullable()->after('other_earnings');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('salary_templates') && Schema::hasColumn('salary_templates', 'other_deductions')) {
            Schema::table('salary_templates', function (Blueprint $table) {
                $table->dropColumn('other_deductions');
            });
        }
    }
};
