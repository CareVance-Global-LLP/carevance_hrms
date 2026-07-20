<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('salary_revision_letters', function (Blueprint $table) {
            $table->decimal('arrear_amount', 14, 2)->default(0)->after('new_ctc');
            $table->text('rejection_reason')->nullable()->after('rejected_at');
        });
    }

    public function down(): void
    {
        Schema::table('salary_revision_letters', function (Blueprint $table) {
            $table->dropColumn(['arrear_amount', 'rejection_reason']);
        });
    }
};
