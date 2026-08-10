<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The project form has always shown an eight-swatch colour picker, but there
 * was nowhere to put the answer: `color` was an appended attribute derived from
 * `id % 8`, so every colour a user chose was discarded on save while the card
 * kept rendering whatever the row id happened to map to.
 *
 * Leaving the column null preserves that derived value (see Project::color), so
 * no existing project changes appearance — the picker just starts working.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->string('color', 32)->nullable()->after('description');
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn('color');
        });
    }
};
