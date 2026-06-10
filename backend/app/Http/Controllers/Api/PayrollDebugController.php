<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayrollDebugController extends Controller
{
    /**
     * Debug departments endpoint
     */
    public function debugDepartments(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        
        // Get all departments
        $departments = \App\Models\Group::where('organization_id', $organizationId)
            ->where('is_active', true)
            ->get();
        
        // Get all users in organization
        $users = \App\Models\User::where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->get();
        
        // Get group_user assignments
        $assignments = \DB::table('group_user')
            ->join('groups', 'group_user.group_id', '=', 'groups.id')
            ->where('groups.organization_id', $organizationId)
            ->select('group_user.*', 'groups.name as group_name')
            ->get();
        
        // Debug specific department
        $departmentId = $request->get('dept_id');
        $debugEmployees = null;
        
        if ($departmentId) {
            $debugEmployees = \App\Models\User::where('organization_id', $organizationId)
                ->whereIn('role', ['employee', 'manager', 'admin'])
                ->whereExists(function ($query) use ($departmentId) {
                    $query->select(\DB::raw(1))
                        ->from('group_user')
                        ->whereColumn('group_user.user_id', 'users.id')
                        ->where('group_user.group_id', $departmentId);
                })
                ->get();
        }
        
        return response()->json([
            'organization_id' => $organizationId,
            'total_departments' => $departments->count(),
            'departments' => $departments->map(function($d) {
                return [
                    'id' => $d->id,
                    'name' => $d->name,
                    'is_active' => $d->is_active,
                ];
            }),
            'total_users' => $users->count(),
            'users' => $users->map(function($u) {
                return [
                    'id' => $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'role' => $u->role,
                ];
            }),
            'total_assignments' => $assignments->count(),
            'assignments' => $assignments->map(function($a) {
                return [
                    'group_id' => $a->group_id,
                    'user_id' => $a->user_id,
                    'group_name' => $a->group_name,
                ];
            }),
            'debug_department_id' => $departmentId,
            'debug_employees' => $debugEmployees ? $debugEmployees->map(function($e) {
                return [
                    'id' => $e->id,
                    'name' => $e->name,
                    'email' => $e->email,
                ];
            }) : null,
        ]);
    }
}
