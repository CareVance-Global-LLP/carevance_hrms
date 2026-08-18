<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The personal details an employee record was missing.
 *
 * BLOOD GROUP is duty-of-care rather than statutory: it is what an emergency
 * contact number is for. Holding the contact but not the group means the call
 * gets made and the hospital still has to ask.
 *
 * PERMANENT ADDRESS is a genuinely separate fact from the current one, not a
 * longer version of it. The profile has carried exactly one address, so an
 * employee who moves for work overwrites the address their documents, their
 * PF nomination and their bank KYC are registered against — and nothing in the
 * record remembers the original. Form 16 prints the address on file.
 *
 * Deliberately NOT added: a name-as-per-Aadhaar column. first_name /
 * middle_name / last_name already compose it — the middle-name migration says
 * so in as many words — and a fourth name column would be a second source of
 * truth for the same string, which is how PAN and UAN ended up living in two
 * places and disagreeing.
 *
 * Guarded throughout. The schema has drifted from these migrations before;
 * 2026_08_12_090000 (middle_name) carries the same warning.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('employee_profiles')) {
            return;
        }

        Schema::table('employee_profiles', function (Blueprint $table) {
            if (! Schema::hasColumn('employee_profiles', 'blood_group')) {
                // 8 rather than 3: "AB+" fits in three, "O NEGATIVE" does not,
                // and a truncated blood group is worse than none.
                $table->string('blood_group', 8)->nullable();
            }

            if (! Schema::hasColumn('employee_profiles', 'permanent_address_line')) {
                // text, matching address_line. An Indian address with a
                // care-of line routinely overruns a varchar(255).
                $table->text('permanent_address_line')->nullable();
            }

            foreach ([
                'permanent_city' => 120,
                'permanent_state' => 120,
                'permanent_postal_code' => 32,
            ] as $column => $length) {
                if (! Schema::hasColumn('employee_profiles', $column)) {
                    $table->string($column, $length)->nullable();
                }
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('employee_profiles')) {
            return;
        }

        Schema::table('employee_profiles', function (Blueprint $table) {
            foreach ([
                'blood_group',
                'permanent_address_line',
                'permanent_city',
                'permanent_state',
                'permanent_postal_code',
            ] as $column) {
                if (Schema::hasColumn('employee_profiles', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
