<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Lets HR decide which documents on a person's record that person can see.
 *
 * Until now every file attached to an employee was equal, so the employee's own
 * view had to be filtered to `uploaded_by = self` — the only boundary available.
 * That kept warning letters and background checks private, at the cost of also
 * hiding the employee's offer letter and Form 16 from them.
 *
 * Defaulting to FALSE is the whole point. A default of true would publish every
 * document already on file the moment this migration ran, including whatever HR
 * uploaded on the understanding that it was internal. Nothing is backfilled;
 * existing documents stay private until somebody deliberately shares them.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('employee_documents')) {
            return;
        }

        if (Schema::hasColumn('employee_documents', 'visible_to_employee')) {
            return;
        }

        Schema::table('employee_documents', function (Blueprint $table) {
            $table->boolean('visible_to_employee')->default(false);
            // The employee's own list filters on this alongside user_id.
            $table->index(['user_id', 'visible_to_employee']);
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('employee_documents', 'visible_to_employee')) {
            return;
        }

        Schema::table('employee_documents', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'visible_to_employee']);
            $table->dropColumn('visible_to_employee');
        });
    }
};
