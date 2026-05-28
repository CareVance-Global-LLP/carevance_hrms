<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'trial_used_at')) {
                $table->timestamp('trial_used_at')->nullable()->after('remember_token');
            }
            if (!Schema::hasColumn('users', 'trial_ended_at')) {
                $table->timestamp('trial_ended_at')->nullable()->after('trial_used_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['trial_used_at', 'trial_ended_at']);
        });
    }
};
