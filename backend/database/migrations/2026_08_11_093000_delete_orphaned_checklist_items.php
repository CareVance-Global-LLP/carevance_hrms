<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Remove checklist items whose subject no longer exists.
 *
 * `checklist_items.subject_type`/`subject_id` is polymorphic, so no foreign key
 * could cascade the delete, and removing a journey or an exit left its items
 * behind. A production workspace was found holding 36 such rows pointing at two
 * onboarding journeys that had already been deleted — enough to distort any
 * "pending onboarding tasks" count read off this table.
 *
 * The models now delete their own items (see OnboardingJourney::booted and
 * EmployeeExit::booted). This clears what accumulated before that existed.
 *
 * Written to survive being run on a database where either subject table is
 * missing, and to touch only rows whose subject is genuinely absent.
 */
return new class extends Migration
{
    /** subject_type => the table that should hold the row. */
    private const SUBJECTS = [
        \App\Models\OnboardingJourney::class => 'onboarding_journeys',
        \App\Models\EmployeeExit::class => 'employee_exits',
    ];

    public function up(): void
    {
        if (! Schema::hasTable('checklist_items')) {
            return;
        }

        foreach (self::SUBJECTS as $type => $table) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            DB::table('checklist_items')
                ->where('subject_type', $type)
                ->whereNotIn('subject_id', function ($query) use ($table) {
                    $query->select('id')->from($table);
                })
                ->delete();
        }

        // Anything whose subject_type is not a class we know about is also
        // unreachable — the morph map has only ever held these two.
        DB::table('checklist_items')
            ->whereNotIn('subject_type', array_keys(self::SUBJECTS))
            ->delete();
    }

    /**
     * Deleted rows are not recoverable, and they referenced subjects that no
     * longer exist, so there is nothing meaningful to restore.
     */
    public function down(): void
    {
        //
    }
};
