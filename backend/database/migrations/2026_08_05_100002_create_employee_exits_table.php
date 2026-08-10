<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The exit process, kept separate from the resignation request.
 *
 * `full_and_final_settlements.exit_type` already recognises five ways to leave,
 * but a resignation can only ever produce one of them — a termination, a
 * retirement or a death is not a resignation and cannot be recorded as one
 * without lying about it. Separating the request from the process also lets HR
 * open an exit with no resignation behind it at all.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_exits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            // Null for an HR-initiated exit.
            $table->foreignId('resignation_id')->nullable()->constrained('resignations')->nullOnDelete();

            $table->enum('exit_type', ['resignation', 'termination', 'retirement', 'death', 'layoff'])
                ->default('resignation');
            $table->text('exit_reason')->nullable();

            $table->date('notice_start_date')->nullable();
            $table->date('last_working_date');
            $table->unsignedInteger('notice_period_days')->default(0);
            $table->unsignedInteger('served_days')->default(0);
            $table->unsignedInteger('shortfall_days')->default(0);

            $table->enum('stage', ['notice', 'clearance', 'settlement', 'closed'])->default('notice');
            $table->timestamp('clearance_completed_at')->nullable();
            $table->timestamp('access_revoked_at')->nullable();
            $table->timestamp('closed_at')->nullable();

            $table->foreignId('initiated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'stage']);
            $table->index(['organization_id', 'last_working_date']);
            // One open exit per person; a closed one may be followed by a rehire.
            $table->index(['user_id', 'stage']);
        });

        Schema::create('exit_interviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('employee_exit_id')->constrained('employee_exits')->cascadeOnDelete();

            // Structured, not a PDF — the whole point is being able to group by
            // reason and see why people actually leave.
            $table->enum('primary_reason', [
                'compensation', 'career_growth', 'management', 'work_life_balance',
                'relocation', 'health', 'higher_studies', 'role_mismatch', 'culture', 'other',
            ])->nullable();
            $table->json('responses')->nullable();
            $table->unsignedTinyInteger('would_recommend')->nullable();
            $table->boolean('would_rejoin')->nullable();
            $table->text('comments')->nullable();
            $table->boolean('is_confidential')->default(true);
            $table->foreignId('conducted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamps();

            $table->unique('employee_exit_id');
            $table->index(['organization_id', 'primary_reason']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exit_interviews');
        Schema::dropIfExists('employee_exits');
    }
};
