<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_punches', function (Blueprint $table) {
            $table->decimal('punch_in_latitude', 10, 7)->nullable()->after('worked_seconds');
            $table->decimal('punch_in_longitude', 10, 7)->nullable()->after('punch_in_latitude');
            $table->decimal('punch_out_latitude', 10, 7)->nullable()->after('punch_in_longitude');
            $table->decimal('punch_out_longitude', 10, 7)->nullable()->after('punch_out_latitude');
        });
    }

    public function down(): void
    {
        Schema::table('attendance_punches', function (Blueprint $table) {
            $table->dropColumn(['punch_in_latitude', 'punch_in_longitude', 'punch_out_latitude', 'punch_out_longitude']);
        });
    }
};
