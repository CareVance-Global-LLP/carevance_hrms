<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fields the renewal cycle needs.
 *
 * Before this, an organization carried a `subscription_expires_at` that nothing
 * ever acted on: no job read it, and the middleware only expired *trials*. A
 * paid plan past its date stayed active indefinitely. These columns are what
 * SubscriptionCycleService needs to move a subscription through its states and
 * to send each reminder exactly once per cycle.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            if (!Schema::hasColumn('organizations', 'auto_renew')) {
                $table->boolean('auto_renew')->default(false)->after('billing_cycle');
            }
            if (!Schema::hasColumn('organizations', 'grace_ends_at')) {
                $table->date('grace_ends_at')->nullable()->after('subscription_expires_at');
            }
            if (!Schema::hasColumn('organizations', 'last_renewal_at')) {
                $table->date('last_renewal_at')->nullable()->after('grace_ends_at');
            }
            if (!Schema::hasColumn('organizations', 'razorpay_mandate_id')) {
                $table->string('razorpay_mandate_id')->nullable()->after('last_renewal_at');
            }
            // Which reminder was last sent, and for which renewal date. The pair
            // is what makes reminders idempotent: re-running the daily command
            // cannot send T-7 twice, and a new cycle resets it by virtue of the
            // date changing.
            if (!Schema::hasColumn('organizations', 'renewal_reminder_stage')) {
                $table->unsignedSmallInteger('renewal_reminder_stage')->nullable()->after('razorpay_mandate_id');
            }
            if (!Schema::hasColumn('organizations', 'renewal_reminder_for')) {
                $table->date('renewal_reminder_for')->nullable()->after('renewal_reminder_stage');
            }
        });

        // 'past_due' is a new state between active and expired. Postgres carries
        // a CHECK constraint that would reject it; sqlite/mysql do not.
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_subscription_status_check');
            DB::statement("ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_status_check CHECK (subscription_status IN ('trial', 'active', 'past_due', 'cancelled', 'expired', 'inactive'))");
        }
    }

    public function down(): void
    {
        DB::statement("UPDATE organizations SET subscription_status = 'expired' WHERE subscription_status = 'past_due'");

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_subscription_status_check');
            DB::statement("ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_status_check CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'expired', 'inactive'))");
        }

        Schema::table('organizations', function (Blueprint $table) {
            foreach ([
                'auto_renew',
                'grace_ends_at',
                'last_renewal_at',
                'razorpay_mandate_id',
                'renewal_reminder_stage',
                'renewal_reminder_for',
            ] as $column) {
                if (Schema::hasColumn('organizations', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
