<?php

namespace Database\Seeders;

use App\Models\DepartmentTeam;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Restructures the organization into a clean demo state:
 *  - Every department (group) keeps exactly TWO teams.
 *  - Each department's two teams get a balanced split of managers + employees.
 *  - If a department lacks enough managers, existing employees are promoted.
 *  - If a department lacks enough people overall, new users are created.
 *
 * Idempotent: extra teams are deleted, pivots are synced, and created users
 * are reused via deterministic emails.
 */
class OrgStructureSeeder extends Seeder
{
    private const MANAGERS_PER_TEAM = 1;
    private const EMPLOYEES_PER_TEAM = 4;
    private const SEED_PASSWORD = 'password123';

    public function run(): void
    {
        $orgId = 1; // Ayush Company
        $admin = User::where('organization_id', $orgId)->where('role', 'admin')->first();
        $adminId = $admin?->id;
        $managerRoleId = Role::where('slug', 'manager')->value('id');
        $employeeRoleId = Role::where('slug', 'employee')->value('id');

        // Attach any orphan employees (not in any group) to Engineering so they are not lost.
        User::where('organization_id', $orgId)
            ->where('role', 'employee')
            ->whereDoesntHave('groups')
            ->get()
            ->each(fn (User $u) => $u->groups()->attach(1));

        $departments = Group::where('organization_id', $orgId)->orderBy('id')->get();

        foreach ($departments as $dept) {
            // 1. Ensure exactly two teams.
            $teams = DepartmentTeam::where('department_id', $dept->id)->orderBy('id')->get();
            if ($teams->count() > 2) {
                foreach ($teams->slice(2) as $extra) {
                    DB::table('department_team_members')->where('team_id', $extra->id)->delete();
                    DB::table('department_team_managers')->where('team_id', $extra->id)->delete();
                    $extra->delete();
                }
                $teams = $teams->slice(0, 2)->values();
            }
            while ($teams->count() < 2) {
                $n = $teams->count() + 1;
                $teams->push(DepartmentTeam::create([
                    'organization_id' => $orgId,
                    'department_id' => $dept->id,
                    'name' => $dept->name . ' Team ' . chr(64 + $n),
                    'slug' => Str::slug($dept->name . '-team-' . $n),
                ]));
            }
            $teamA = $teams[0];
            $teamB = $teams[1];

            // 2. Pool of existing (non-admin) users belonging to this department.
            $pool = User::query()
                ->where('organization_id', $orgId)
                ->whereIn('role', ['employee', 'manager'])
                ->whereHas('groups', fn ($q) => $q->where('groups.id', $dept->id))
                ->get();

            $needManagers = self::MANAGERS_PER_TEAM * 2;
            $needEmployees = self::EMPLOYEES_PER_TEAM * 2;

            // 3. Promote employees to managers if short on managers.
            $managers = $pool->where('role', 'manager')->values();
            $employees = $pool->where('role', 'employee')->values();
            $toPromote = max(0, $needManagers - $managers->count());
            for ($i = 0; $i < $toPromote && $i < $employees->count(); $i++) {
                $emp = $employees[$i];
                $emp->role = 'manager';
                $emp->role_id = $managerRoleId;
                $emp->save();
            }
            $pool->each(fn (User $u) => $u->refresh());
            $managers = $pool->where('role', 'manager')->values();
            $employees = $pool->where('role', 'employee')->values();

            // 4. Create new users to fill any remaining shortfall.
            while ($managers->count() < $needManagers) {
                $managers->push($this->createUser($orgId, $managerRoleId, $dept, $managers->count() + 1, 'mgr'));
            }
            while ($employees->count() < $needEmployees) {
                $employees->push($this->createUser($orgId, $employeeRoleId, $dept, $employees->count() + 1, 'emp'));
            }

            // 5. Partition: each team gets one manager + EMPLOYEES_PER_TEAM employees.
            $mgrA = $managers[0];
            $mgrB = $managers[1];
            $empA = $employees->slice(0, self::EMPLOYEES_PER_TEAM)->values();
            $empB = $employees->slice(self::EMPLOYEES_PER_TEAM, self::EMPLOYEES_PER_TEAM)->values();

            // 6. Reporting lines (drives the org chart + "Reports to" labels).
            $this->ensureWorkInfo($mgrA, $dept->id, $adminId);
            $this->ensureWorkInfo($mgrB, $dept->id, $adminId);
            foreach ($empA as $e) {
                $this->ensureWorkInfo($e, $dept->id, $mgrA->id);
            }
            foreach ($empB as $e) {
                $this->ensureWorkInfo($e, $dept->id, $mgrB->id);
            }

            // 7. Sync team pivots.
            $teamA->managers()->sync([$mgrA->id]);
            $teamA->members()->sync($empA->pluck('id')->all());
            $teamB->managers()->sync([$mgrB->id]);
            $teamB->members()->sync($empB->pluck('id')->all());

            $this->command?->info(
                "Department {$dept->name}: Team A ({$mgrA->name} + " . $empA->count() . "), "
                . "Team B ({$mgrB->name} + " . $empB->count() . ")"
            );
        }
    }

    private function createUser(int $orgId, ?int $roleId, Group $dept, int $n, string $kind): User
    {
        $email = "seed.{$dept->id}.{$kind}{$n}@carevance.seed";
        $existing = User::where('email', $email)->first();
        if ($existing) {
            if (!$existing->groups()->where('groups.id', $dept->id)->exists()) {
                $existing->groups()->attach($dept->id);
            }
            return $existing;
        }

        $user = User::create([
            'name' => ($kind === 'mgr' ? 'Lead ' : 'Member ') . $dept->name . ' ' . $n,
            'email' => $email,
            'password' => Hash::make(self::SEED_PASSWORD),
            'role' => $kind === 'mgr' ? 'manager' : 'employee',
            'role_id' => $roleId,
            'organization_id' => $orgId,
            'email_verified_at' => now(),
        ]);
        $user->groups()->attach($dept->id);

        return $user;
    }

    private function ensureWorkInfo(User $user, int $deptId, ?int $managerId): void
    {
        $wi = EmployeeWorkInfo::firstOrNew(['user_id' => $user->id]);
        $wi->organization_id = $user->organization_id;
        $wi->report_group_id = $deptId;
        $wi->reporting_manager_id = $managerId;
        if (empty($wi->employee_code)) {
            $wi->employee_code = 'EMP' . str_pad((string) $user->id, 4, '0', STR_PAD_LEFT);
        }
        if (empty($wi->employment_type)) {
            $wi->employment_type = 'full_time';
        }
        if (empty($wi->employment_status)) {
            $wi->employment_status = 'active';
        }
        $wi->save();
    }
}
