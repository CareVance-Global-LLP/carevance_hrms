<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The three leave-policy choices a Keka comparison turns on.
 *
 * Every default below reproduces today's behaviour exactly, because these
 * columns land on live entitlement data. A migration that changed when leave
 * was credited, or what happened to it at year end, would move every employee's
 * balance overnight — the one leave bug a customer notices immediately and
 * never forgets.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leave_types', function (Blueprint $table) {
            /*
             * period_start | period_end.
             *
             * Defaults to period_start, which is what the accrual service
             * already does and what "you get a day and a half a month" means to
             * the person receiving it. Crediting at the end means somebody who
             * joined on the 1st can take nothing until the 31st — a real policy
             * some employers run, and the reason this is a choice rather than
             * a constant.
             */
            $table->string('accrual_timing', 16)->default('period_start')->after('accrual_frequency');

            /*
             * carry_forward | reset | encash.
             *
             * Defaults to carry_forward because `carry_forward_cap` already
             * exists and already governs it; a cap of zero has always meant
             * "expires", so today's behaviour is carry-forward-with-a-cap and
             * that is what this default preserves.
             */
            $table->string('year_end_action', 16)->default('carry_forward')->after('carry_forward_expiry_months');

            /*
             * A separate accrual rate while serving notice, mirroring
             * probation_annual_quota exactly — including that NULL means "the
             * normal rate", never zero. Treating unset as zero would silently
             * stop accrual for everybody on notice the moment this column
             * existed.
             */
            $table->decimal('notice_period_annual_quota', 6, 2)->nullable()->after('probation_annual_quota');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_accrual_timing_check');
            DB::statement("ALTER TABLE leave_types ADD CONSTRAINT leave_types_accrual_timing_check "
                ."CHECK (accrual_timing IN ('period_start', 'period_end'))");

            DB::statement('ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_year_end_check');
            DB::statement("ALTER TABLE leave_types ADD CONSTRAINT leave_types_year_end_check "
                ."CHECK (year_end_action IN ('carry_forward', 'reset', 'encash'))");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_accrual_timing_check');
            DB::statement('ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_year_end_check');
        }

        Schema::table('leave_types', function (Blueprint $table) {
            $table->dropColumn(['accrual_timing', 'year_end_action', 'notice_period_annual_quota']);
        });
    }
};
