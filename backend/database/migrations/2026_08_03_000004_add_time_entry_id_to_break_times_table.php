<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A break has always been written as two rows — a break_times row and an
     * is_break time_entries row — created together and then read by completely
     * separate code with nothing joining them. BreakTrackingController::start
     * even returned break_entry_id to the client but persisted it nowhere, so
     * end() had to re-find the entry by "newest open is_break row for this
     * user", with no id and no date binding, and deleting a break removed only
     * one half.
     *
     * This is the missing link. Every other break fix depends on it.
     */
    public function up(): void
    {
        if (! Schema::hasTable('break_times') || Schema::hasColumn('break_times', 'time_entry_id')) {
            return;
        }

        Schema::table('break_times', function (Blueprint $table) {
            $table->foreignId('time_entry_id')
                ->nullable()
                ->after('user_id')
                ->constrained('time_entries')
                ->nullOnDelete();
        });

        $this->backfill();
    }

    /**
     * Pair up existing rows where the match is unambiguous: the same user, an
     * is_break entry starting within a minute of the break, and exactly one
     * candidate on each side. Anything ambiguous is left null rather than
     * guessed — a wrong link is worse than no link.
     */
    private function backfill(): void
    {
        DB::table('break_times')->orderBy('id')->chunkById(200, function ($breaks) {
            foreach ($breaks as $break) {
                $candidates = DB::table('time_entries')
                    ->where('user_id', $break->user_id)
                    ->where('is_break', true)
                    ->whereBetween('start_time', [
                        (string) date('Y-m-d H:i:s', strtotime($break->start_at) - 60),
                        (string) date('Y-m-d H:i:s', strtotime($break->start_at) + 60),
                    ])
                    ->whereNotIn('id', function ($query) {
                        $query->select('time_entry_id')
                            ->from('break_times')
                            ->whereNotNull('time_entry_id');
                    })
                    ->pluck('id');

                if ($candidates->count() !== 1) {
                    continue;
                }

                DB::table('break_times')
                    ->where('id', $break->id)
                    ->update(['time_entry_id' => $candidates->first()]);
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('break_times') || ! Schema::hasColumn('break_times', 'time_entry_id')) {
            return;
        }

        Schema::table('break_times', function (Blueprint $table) {
            $table->dropForeign(['time_entry_id']);
            $table->dropColumn('time_entry_id');
        });
    }
};
