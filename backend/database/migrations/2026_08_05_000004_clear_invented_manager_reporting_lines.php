<?php

use App\Models\Organization;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Clear reporting lines the system invented for managers.
     *
     * The old group sync wrote a reporting_manager_id onto EVERY member of a
     * department, not just employees — it picked the most senior person in the
     * group and pointed everyone else at them. In a department with two
     * managers that made one manager report to the other. Nobody chose it.
     *
     * Manager-reports-to-manager is a perfectly legitimate SHAPE — Zoho's own
     * documented example is CEO > VP > Manager > Executive, and every HRMS
     * supports arbitrary depth. So this does not outlaw it. It only removes the
     * lines that were generated rather than chosen, which are the ones that
     * made the org chart disagree with reality.
     *
     * Cleared, not repointed at an admin: repointing would invent a different
     * line to replace an invented one. A blank line surfaces in the UI as
     * "No reporting manager" and gets filled in deliberately.
     *
     * Explicit lines are never touched.
     */
    public function up(): void
    {
        if (! Schema::hasTable('employee_work_infos') || ! Schema::hasTable('users')) {
            return;
        }

        $hasSourceColumn = Schema::hasColumn('employee_work_infos', 'reporting_manager_source');

        DB::table('employee_work_infos')
            ->whereNotNull('reporting_manager_id')
            ->orderBy('id')
            ->chunkById(200, function ($rows) use ($hasSourceColumn) {
                foreach ($rows as $row) {
                    if ($hasSourceColumn && $row->reporting_manager_source === 'explicit') {
                        continue;
                    }

                    // Only managers and admins — employees legitimately receive
                    // a derived manager and must keep it.
                    if ($this->levelForUser((int) $row->user_id) >= 100) {
                        continue;
                    }

                    DB::table('employee_work_infos')
                        ->where('id', $row->id)
                        ->update(['reporting_manager_id' => null]);
                }
            });
    }

    private function levelForUser(int $userId): int
    {
        $user = DB::table('users')->where('id', $userId)->first(['role', 'role_id']);

        if (! $user) {
            return 100;
        }

        if (! empty($user->role_id)) {
            $customLevel = DB::table('roles')->where('id', $user->role_id)->value('hierarchy_level');

            if ($customLevel !== null) {
                return (int) $customLevel;
            }
        }

        return (int) (Organization::SYSTEM_ROLE_HIERARCHY_LEVELS[$user->role] ?? 100);
    }

    public function down(): void
    {
        // Data repair; the invented values are not worth restoring.
    }
};
