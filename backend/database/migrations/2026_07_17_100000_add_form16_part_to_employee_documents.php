<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_documents', function (Blueprint $table) {
            $table->string('part', 1)->nullable()->after('category')->comment('A or B for Form 16 documents');
            $table->string('financial_year', 9)->nullable()->after('part')->comment('YYYY-YY format for Form 16');
            
            // Index for efficient lookups of Form 16 documents
            $table->index(['user_id', 'category', 'part', 'financial_year'], 'emp_docs_form16_lookup');
        });
    }

    public function down(): void
    {
        Schema::table('employee_documents', function (Blueprint $table) {
            $table->dropIndex('emp_docs_form16_lookup');
            $table->dropColumn(['part', 'financial_year']);
        });
    }
};