<?php

use App\Models\Organization;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Repair reporting lines that already point at an admin.
     *
     * Four separate copies of the "who manages this group" logic could select an
     * admin — EmployeeWorkspaceService listed 'admin' as an eligible candidate
     * outright. Those copies are now one resolver that excludes admins, but that
     * only governs NEW writes: every row already written stayed wrong, which is
     * why the admin kept showing as the manager after the code fix.
     *
     * For each affected employee, re-point at a real manager in their group;
     * where the group has none, clear the line. Null is a visible gap somebody
     * fixes — pointing at an admin is a silent misroute of every approval.
     *
     * Explicit lines are left alone: if a human deliberately set an admin as
     * someone's manager, that is their call to make.
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

                    if (! $this->isAdmin((int) $row->reporting_manager_id)) {
                        continue;
                    }

                    $replacement = $row->report_group_id
                        ? $this->managerForGroup((int) $row->organization_id, (int) $row->report_group_id, (int) $row->user_id)
                        : null;

                    DB::table('employee_work_infos')
                        ->where('id', $row->id)
                        ->update(['reporting_manager_id' => $replacement]);
                }
            });
    }

    private function isAdmin(int $userId): bool
    {
        $user = DB::table('users')->where('id', $userId)->first(['role', 'role_id']);

        if (! $user) {
            return false;
        }

        $level = $this->levelFor($user);

        return $level <= 10;
    }

    /** A real manager in the group: above admin level, below employee level. */
    private function managerForGroup(int $organizationId, int $groupId, int $excludeUserId): ?int
    {
        $candidates = DB::table('users')
            ->join('group_user', 'group_user.user_id', '=', 'users.id')
            ->where('users.organization_id', $organizationId)
            ->where('group_user.group_id', $groupId)
            ->where('users.id', '!=', $excludeUserId)
            ->orderBy('users.name')
            ->get(['users.id', 'users.role', 'users.role_id']);

        foreach ($candidates as $candidate) {
            $level = $this->levelFor($candidate);

            if ($level > 10 && $level < 100) {
                return (int) $candidate->id;
            }
        }

        return null;
    }

    private function levelFor(object $user): int
    {
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
        // Data repair; the previous (wrong) values are not worth restoring.
    }
};
