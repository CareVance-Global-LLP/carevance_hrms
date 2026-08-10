<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Break TYPES replace the free-text reason.
     *
     * A break used to carry only an arbitrary string, which meant the system
     * could say nothing about it: whether it is paid, whether it has a limit,
     * how much of an allowance is left. Worse, payroll treatment was decided
     * implicitly — every break was excluded from worked time because the code
     * happened to filter is_break, a policy nobody actually chose.
     *
     * is_paid makes that decision explicit and per-type (Hubstaff/Time Doctor
     * model): paid breaks count into payable worked time, unpaid ones do not.
     * max_minutes_per_day is a soft allowance (Keka model) — overage flags, it
     * does not block.
     */
    public function up(): void
    {
        Schema::create('break_types', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->boolean('is_paid')->default(false);
            $table->unsignedSmallInteger('max_minutes_per_day')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['organization_id', 'name']);
        });

        if (! Schema::hasColumn('time_entries', 'break_type_id')) {
            Schema::table('time_entries', function (Blueprint $table) {
                $table->foreignId('break_type_id')
                    ->nullable()
                    ->after('is_break')
                    ->constrained('break_types')
                    ->nullOnDelete();
            });
        }

        if (Schema::hasTable('break_times') && ! Schema::hasColumn('break_times', 'break_type_id')) {
            Schema::table('break_times', function (Blueprint $table) {
                $table->foreignId('break_type_id')
                    ->nullable()
                    ->after('time_entry_id')
                    ->constrained('break_types')
                    ->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('break_times') && Schema::hasColumn('break_times', 'break_type_id')) {
            Schema::table('break_times', function (Blueprint $table) {
                $table->dropForeign(['break_type_id']);
                $table->dropColumn('break_type_id');
            });
        }

        if (Schema::hasColumn('time_entries', 'break_type_id')) {
            Schema::table('time_entries', function (Blueprint $table) {
                $table->dropForeign(['break_type_id']);
                $table->dropColumn('break_type_id');
            });
        }

        Schema::dropIfExists('break_types');
    }
};
