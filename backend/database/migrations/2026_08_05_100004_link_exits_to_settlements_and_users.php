<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * The settlement stops re-declaring the exit.
         *
         * `resignation_date`, `last_working_date`, `exit_type` and `exit_reason`
         * stay as columns on purpose — a settlement is a snapshot of what was
         * actually paid and must not move if the exit record is edited later.
         * What changes is where they come from: the service reads them off the
         * exit instead of a human retyping them.
         */
        Schema::table('full_and_final_settlements', function (Blueprint $table) {
            $table->foreignId('employee_exit_id')->nullable()->after('user_id')
                ->constrained('employee_exits')->nullOnDelete();
            $table->index('employee_exit_id');
        });

        Schema::table('resignations', function (Blueprint $table) {
            // The policy in force when it was submitted, so a later policy change
            // cannot retroactively make somebody short.
            $table->unsignedInteger('notice_period_days')->nullable()->after('reason');
            $table->integer('shortfall_days')->nullable()->after('notice_period_days');
        });

        /*
         * Deactivation had nowhere to live: `User::getIsActiveAttribute()`
         * returned a hardcoded `true`, so "revoke access on the last working day"
         * had nothing to write to. Nothing filtered on it, so giving it a real
         * backing column changes no existing behaviour.
         */
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('deactivated_at')->nullable()->after('remember_token');
            $table->string('deactivation_reason', 100)->nullable()->after('deactivated_at');
            $table->index('deactivated_at');
        });
    }

    public function down(): void
    {
        Schema::table('full_and_final_settlements', function (Blueprint $table) {
            $table->dropConstrainedForeignId('employee_exit_id');
        });

        Schema::table('resignations', function (Blueprint $table) {
            $table->dropColumn(['notice_period_days', 'shortfall_days']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['deactivated_at']);
            $table->dropColumn(['deactivated_at', 'deactivation_reason']);
        });
    }
};
