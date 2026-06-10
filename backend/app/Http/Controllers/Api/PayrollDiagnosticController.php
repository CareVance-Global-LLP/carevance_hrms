<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Group;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PayrollDiagnosticController extends Controller
{
    /**
     * Comprehensive diagnostic endpoint for payroll issues
     */
    public function diagnose(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $departmentId = $request->get('department_id');
        
        $diagnostics = [
            'timestamp' => now()->toDateTimeString(),
            'organization_id' => $organizationId,
            'user_id' => $request->user()->id,
            'user_role' => $request->user()->role,
        ];

        // 1. Check database connection
        try {
            DB::connection()->getPdo();
            $diagnostics['database_connection'] = 'OK';
        } catch (\Exception $e) {
            $diagnostics['database_connection'] = 'FAILED: ' . $e->getMessage();
            return response()->json($diagnostics);
        }

        // 2. Check organization exists
        $org = DB::table('organizations')->where('id', $organizationId)->first();
        $diagnostics['organization_exists'] = $org ? true : false;
        $diagnostics['organization_name'] = $org?->name;

        // 3. Count total users
        $totalUsers = User::where('organization_id', $organizationId)->count();
        $diagnostics['total_users_in_org'] = $totalUsers;

        // 4. Count users by role
        $usersByRole = User::where('organization_id', $organizationId)
            ->select('role', DB::raw('count(*) as count'))
            ->groupBy('role')
            ->pluck('count', 'role')
            ->toArray();
        $diagnostics['users_by_role'] = $usersByRole;

        // 5. Check departments
        $departments = Group::where('organization_id', $organizationId)
            ->where('is_active', true)
            ->get()
            ->map(function($dept) {
                return [
                    'id' => $dept->id,
                    'name' => $dept->name,
                    'code' => $dept->code,
                    'is_active' => $dept->is_active,
                ];
            });
        $diagnostics['departments'] = $departments;
        $diagnostics['department_count'] = $departments->count();

        // 6. Check group_user assignments
        $assignments = DB::table('group_user')
            ->join('groups', 'group_user.group_id', '=', 'groups.id')
            ->where('groups.organization_id', $organizationId)
            ->select(
                'group_user.group_id',
                'groups.name as group_name',
                DB::raw('count(*) as user_count'),
                DB::raw('GROUP_CONCAT(group_user.user_id) as user_ids')
            )
            ->groupBy('group_user.group_id', 'groups.name')
            ->get()
            ->map(function($row) {
                return [
                    'group_id' => $row->group_id,
                    'group_name' => $row->group_name,
                    'user_count' => $row->user_count,
                    'user_ids' => explode(',', $row->user_ids),
                ];
            });
        $diagnostics['group_assignments'] = $assignments;

        // 7. Test specific department query if department_id provided
        if ($departmentId) {
            $diagnostics['testing_department_id'] = $departmentId;
            
            // Test 1: Raw SQL
            $rawResults = DB::select(
                'SELECT u.* FROM users u 
                JOIN group_user gu ON u.id = gu.user_id 
                WHERE gu.group_id = ? AND u.organization_id = ?',
                [$departmentId, $organizationId]
            );
            $diagnostics['raw_sql_count'] = count($rawResults);
            $diagnostics['raw_sql_results'] = collect($rawResults)->pluck('id')->toArray();

            // Test 2: Query Builder
            $userIds = DB::table('group_user')
                ->where('group_id', $departmentId)
                ->pluck('user_id');
            
            $diagnostics['user_ids_from_group'] = $userIds->toArray();
            $diagnostics['user_ids_count'] = $userIds->count();

            // Test 3: Eloquent
            $eloquentResults = User::where('organization_id', $organizationId)
                ->whereIn('id', $userIds)
                ->get();
            
            $diagnostics['eloquent_count'] = $eloquentResults->count();
            $diagnostics['eloquent_results'] = $eloquentResults->pluck('id')->toArray();

            // Test 4: With relations
            $withRelations = User::where('organization_id', $organizationId)
                ->whereIn('id', $userIds)
                ->with(['employeeProfile', 'employeeWorkInfo'])
                ->get()
                ->map(function($user) {
                    return [
                        'id' => $user->id,
                        'name' => $user->name,
                        'email' => $user->email,
                        'role' => $user->role,
                        'has_profile' => $user->employeeProfile ? true : false,
                        'has_work_info' => $user->employeeWorkInfo ? true : false,
                        'profile_pan' => $user->employeeProfile?->pan_number,
                    ];
                });
            
            $diagnostics['with_relations_count'] = $withRelations->count();
            $diagnostics['with_relations_results'] = $withRelations;
        }

        // 8. Check for common issues
        $issues = [];

        if ($totalUsers === 0) {
            $issues[] = 'No users found in organization';
        }

        if ($departments->count() === 0) {
            $issues[] = 'No departments found';
        }

        if ($assignments->count() === 0) {
            $issues[] = 'No users assigned to any department';
        }

        // Check if department exists
        if ($departmentId) {
            $deptExists = Group::where('id', $departmentId)
                ->where('organization_id', $organizationId)
                ->exists();
            
            if (!$deptExists) {
                $issues[] = "Department ID {$departmentId} does not exist in this organization";
            }

            // Check if users are in department
            $deptUsers = DB::table('group_user')
                ->where('group_id', $departmentId)
                ->count();
            
            if ($deptUsers === 0) {
                $issues[] = "Department {$departmentId} has no users assigned";
            }
        }

        $diagnostics['issues_found'] = $issues;
        $diagnostics['has_issues'] = count($issues) > 0;

        // 9. Recommendations
        $recommendations = [];
        
        if (count($issues) > 0) {
            if (!isset($usersByRole['employee']) || $usersByRole['employee'] == 0) {
                $recommendations[] = 'Run: php artisan db:seed --class=PayrollTestDataSeeder';
            }
            
            if ($departments->count() === 0) {
                $recommendations[] = 'Create departments first in Settings > Departments';
            }
            
            if ($assignments->count() === 0) {
                $recommendations[] = 'Assign users to departments using the seeder or manually';
            }
        }

        $diagnostics['recommendations'] = $recommendations;

        return response()->json([
            'success' => count($issues) === 0,
            'diagnostics' => $diagnostics,
        ]);
    }

    /**
     * Quick fix endpoint - automatically fix common issues
     */
    public function quickFix(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $fixes = [];
        $errors = [];

        try {
            // Fix 1: Ensure current user has employee profile
            $user = $request->user();
            $profile = DB::table('employee_profiles')
                ->where('user_id', $user->id)
                ->first();
            
            if (!$profile) {
                DB::table('employee_profiles')->insert([
                    'user_id' => $user->id,
                    'organization_id' => $organizationId,
                    'pan_number' => 'PAN' . str_pad($user->id, 8, '0', STR_PAD_LEFT),
                    'tax_regime' => 'new',
                    'is_metro_city' => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $fixes[] = 'Created employee profile for current user';
            }

            // Fix 2: Ensure current user has work info
            $workInfo = DB::table('employee_work_infos')
                ->where('user_id', $user->id)
                ->first();
            
            if (!$workInfo) {
                DB::table('employee_work_infos')->insert([
                    'user_id' => $user->id,
                    'employee_code' => 'EMP' . str_pad($user->id, 4, '0', STR_PAD_LEFT),
                    'designation' => 'Employee',
                    'joining_date' => now()->subYear()->format('Y-m-d'),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $fixes[] = 'Created employee work info for current user';
            }

            // Fix 3: Create default department if none exists
            $deptCount = Group::where('organization_id', $organizationId)->count();
            
            if ($deptCount === 0) {
                $dept = Group::create([
                    'organization_id' => $organizationId,
                    'name' => 'General',
                    'code' => 'GEN',
                    'is_active' => true,
                ]);
                $fixes[] = 'Created default department: General';

                // Assign current user to department
                DB::table('group_user')->insert([
                    'group_id' => $dept->id,
                    'user_id' => $user->id,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $fixes[] = 'Assigned current user to General department';
            }

            // Fix 4: Create payroll template
            $template = DB::table('employee_payroll_templates')
                ->where('user_id', $user->id)
                ->first();
            
            if (!$template) {
                DB::table('employee_payroll_templates')->insert([
                    'user_id' => $user->id,
                    'organization_id' => $organizationId,
                    'annual_ctc' => 600000,
                    'basic_percentage' => 40,
                    'hra_percentage' => 50,
                    'conveyance_allowance' => 1600,
                    'pf_enabled' => true,
                    'esi_enabled' => true,
                    'pt_enabled' => true,
                    'tds_enabled' => true,
                    'tax_regime' => 'new',
                    'is_metro_city' => true,
                    'pt_state' => 'maharashtra',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $fixes[] = 'Created payroll template for current user';
            }

            return response()->json([
                'success' => true,
                'message' => 'Quick fix applied',
                'fixes' => $fixes,
                'errors' => $errors,
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error applying fixes',
                'fixes' => $fixes,
                'errors' => array_merge($errors, [$e->getMessage()]),
            ], 500);
        }
    }

    /**
     * Test the actual department employees API
     */
    public function testDepartmentEmployees(Request $request, int $departmentId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        
        $startTime = microtime(true);
        
        // Step 1: Get user IDs from group_user
        $userIds = DB::table('group_user')
            ->where('group_id', $departmentId)
            ->pluck('user_id');
        
        $step1Time = microtime(true);
        
        // Step 2: Get users
        $users = User::where('organization_id', $organizationId)
            ->whereIn('id', $userIds)
            ->with(['employeeProfile', 'employeeWorkInfo'])
            ->get();
        
        $step2Time = microtime(true);
        
        return response()->json([
            'success' => true,
            'department_id' => $departmentId,
            'user_ids_found' => $userIds->toArray(),
            'user_ids_count' => $userIds->count(),
            'users_found' => $users->count(),
            'users' => $users->map(function($u) {
                return [
                    'id' => $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'has_profile' => $u->employeeProfile ? true : false,
                    'has_work_info' => $u->employeeWorkInfo ? true : false,
                ];
            }),
            'timing' => [
                'step1_user_ids_ms' => round(($step1Time - $startTime) * 1000, 2),
                'step2_users_ms' => round(($step2Time - $step1Time) * 1000, 2),
                'total_ms' => round((microtime(true) - $startTime) * 1000, 2),
            ],
        ]);
    }
}
