<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Group;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PayrollDebugController extends Controller
{
    /**
     * Debug endpoint to test payroll departments
     */
    public function debugDepartments(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        
        Log::info('Debug Payroll Departments', [
            'user_id' => $request->user()->id,
            'organization_id' => $organizationId,
        ]);

        // Get all groups for the organization
        $groups = Group::where('organization_id', $organizationId)
            ->where('is_active', true)
            ->get();

        Log::info('Groups found', ['count' => $groups->count(), 'groups' => $groups->toArray()]);

        // Count users in each group via group_user pivot
        $departments = $groups->map(function ($group) use ($organizationId) {
            $employeeCount = DB::table('group_user')
                ->join('users', 'group_user.user_id', '=', 'users.id')
                ->where('group_user.group_id', $group->id)
                ->whereIn('users.role', ['employee', 'manager', 'admin'])
                ->where('users.organization_id', $organizationId)
                ->count();

            return [
                'id' => $group->id,
                'name' => $group->name,
                'employee_count' => $employeeCount,
            ];
        });

        // Get unassigned count
        $assignedUserIds = DB::table('group_user')
            ->join('groups', 'group_user.group_id', '=', 'groups.id')
            ->where('groups.organization_id', $organizationId)
            ->pluck('group_user.user_id');

        $unassignedCount = User::where('organization_id', $organizationId)
            ->whereNotIn('id', $assignedUserIds)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->count();

        return response()->json([
            'success' => true,
            'user_organization_id' => $organizationId,
            'departments' => $departments,
            'unassigned_count' => $unassignedCount,
            'raw_groups' => $groups,
        ]);
    }
}
