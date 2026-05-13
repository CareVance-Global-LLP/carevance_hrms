<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->string('leave_category', 50)->default('paid')->after('leave_type');
            $table->json('consumed_breakdown')->nullable()->after('leave_category');
        });

        DB::table('leave_requests')
            ->whereNull('leave_category')
            ->update(['leave_category' => 'paid']);
    }

    public function down(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropColumn(['leave_category', 'consumed_breakdown']);
        });
    }
};
