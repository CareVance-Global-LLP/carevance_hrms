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
        Schema::table('employee_work_infos', function (Blueprint $table) {
            $table->time('expected_start_time')->nullable()->after('work_mode');
            $table->string('expected_timezone', 255)->nullable()->after('expected_start_time');
        });
    }

    public function down(): void
    {
        Schema::table('employee_work_infos', function (Blueprint $table) {
            $table->dropColumn(['expected_start_time', 'expected_timezone']);
        });
    }
};
