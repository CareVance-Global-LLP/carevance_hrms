<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * `blurred` was a privacy control that never blurred anything.
     *
     * No capture path ever set it (both the online upload and the offline sync
     * queue omit the field, so the `?? false` default always won), there is no
     * image-processing library anywhere in the project, no UI reads it — the
     * frontend Screenshot type does not even declare the field — and the one
     * actor who could toggle it was the monitored employee themselves, on their
     * own screenshots, with no effect on the bytes served.
     *
     * Shipping a privacy affordance that does nothing is worse than not having
     * one, so the column goes.
     */
    public function up(): void
    {
        if (! Schema::hasTable('screenshots') || ! Schema::hasColumn('screenshots', 'blurred')) {
            return;
        }

        Schema::table('screenshots', function (Blueprint $table) {
            $table->dropColumn('blurred');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('screenshots') || Schema::hasColumn('screenshots', 'blurred')) {
            return;
        }

        Schema::table('screenshots', function (Blueprint $table) {
            $table->boolean('blurred')->default(false);
        });
    }
};
