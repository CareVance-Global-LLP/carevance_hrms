<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Allow leave to accrue twice a year.
 *
 * `leave_types.accrual_frequency` carries a CHECK constraint listing the
 * schedules the application knows about, built from a constant inside the
 * creating migration. Adding a value to `LeaveType::FREQUENCIES` therefore is
 * NOT enough on its own: the model accepts it, validation accepts it, the test
 * suite on SQLite accepts it, and PostgreSQL refuses the INSERT — so the
 * failure appears for the first time on a real deployment.
 *
 * Half-yearly is what the market expects. Keka offers monthly, quarterly,
 * half-yearly and annual accrual, and a buyer comparing side by side reads a
 * missing option as a missing feature.
 */
return new class extends Migration
{
    /** Must match App\Models\LeaveType::FREQUENCIES. */
    private const FREQUENCIES = ['annual', 'monthly', 'quarterly', 'half_yearly'];

    public function up(): void
    {
        // SQLite has no comparable constraint, so the check simply does not
        // exist there; the model constant is the only guard in tests.
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_frequency_check');
        DB::statement(
            "ALTER TABLE leave_types ADD CONSTRAINT leave_types_frequency_check CHECK (accrual_frequency IN ('"
            .implode("', '", self::FREQUENCIES)."'))"
        );
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        /*
         * Rolling back narrows the allowed set, which would fail outright if
         * any row is already half-yearly. Those rows are moved to quarterly
         * rather than blocking the rollback: quarterly is the nearest schedule
         * that exists in the older set, and leaving a deployment unable to roll
         * back is worse than a policy an admin has to re-pick.
         */
        DB::table('leave_types')->where('accrual_frequency', 'half_yearly')->update(['accrual_frequency' => 'quarterly']);

        DB::statement('ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_frequency_check');
        DB::statement(
            "ALTER TABLE leave_types ADD CONSTRAINT leave_types_frequency_check CHECK (accrual_frequency IN ('"
            ."annual', 'monthly', 'quarterly'))"
        );
    }
};
