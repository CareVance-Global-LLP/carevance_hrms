<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Whether the organisation would take this person back.
 *
 * `exit_interviews.would_rejoin` already exists and is a different fact: it is
 * the departing employee's own answer on the way out, given in confidence.
 * Reading it as a hiring decision would let a survey answer decide policy — and
 * it points the wrong way twice over, since somebody the organisation would
 * never rehire may happily say they would come back.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            // A string plus PHP constants, deliberately not enum(). The
            // existing enum('exit_type') and enum('stage') on this table became
            // Postgres CHECK constraints that no later vocabulary change can
            // alter without a second migration, and they behave differently on
            // SQLite (tests) than on Postgres (the app).
            $table->string('rehire_eligibility', 20)->default('undecided');
            $table->text('rehire_note')->nullable();
            $table->foreignId('rehire_decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('rehire_decided_at')->nullable();

            // Stamped when this exit's person actually came back. The row stays
            // `closed` — a rejoin does not undo a period of employment that
            // genuinely ended; this is what marks the exit consumed.
            $table->timestamp('rejoined_at')->nullable();

            // The service start of the employment period THIS exit ended.
            // Gratuity under the Payment of Gratuity Act needs five years of
            // CONTINUOUS service, so a rejoin re-bases
            // employee_work_infos.joining_date and the earlier period survives
            // only here.
            $table->date('previous_joining_date')->nullable();

            $table->index(['organization_id', 'rehire_eligibility']);
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropIndex(['organization_id', 'rehire_eligibility']);
            $table->dropForeign(['rehire_decided_by']);
            $table->dropColumn([
                'rehire_eligibility',
                'rehire_note',
                'rehire_decided_by',
                'rehire_decided_at',
                'rejoined_at',
                'previous_joining_date',
            ]);
        });
    }
};
