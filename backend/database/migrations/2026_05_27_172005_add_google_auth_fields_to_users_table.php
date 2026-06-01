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
        Schema::table('users', function (Blueprint $table) {
            $table->string('google_id')->nullable()->unique()->after('email_verified_at');
            $table->text('google_token')->nullable()->after('google_id');
            $table->text('google_refresh_token')->nullable()->after('google_token');
            $table->index('google_id', 'google_id_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex('google_id_index');
            $table->dropColumn(['google_id', 'google_token', 'google_refresh_token']);
        });
    }
};
