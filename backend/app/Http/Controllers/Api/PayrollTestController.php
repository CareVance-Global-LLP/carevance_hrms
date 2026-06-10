<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PayrollTestController extends Controller
{
    /**
     * Test endpoint to see exactly what the API returns
     */
    public function testResponse(Request $request, int $departmentId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        
        // Get user IDs
        $userIds = DB::table('group_user')
            ->where('group_id', $departmentId)
            ->pluck('user_id');
        
        // Get users with all relations
        $users = \App\Models\User::where('organization_id', $organizationId)
            ->whereIn('id', $userIds)
            ->with(['employeeProfile', 'employeeWorkInfo', 'employeeBankAccounts'])
            ->get();
        
        // Build response exactly like the real endpoint
        $employees = $users->map(function ($user) use ($organizationId) {
            $template = \App\Models\EmployeePayrollTemplate::getOrCreateForUser(
                $user->id,
                $organizationId
            );
            
            return [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
                'avatar' => $user->avatar,
                'employee_code' => $user->employeeWorkInfo?->employee_code ?? null,
                'designation' => $user->employeeWorkInfo?->designation ?? null,
                'joining_date' => $user->employeeWorkInfo?->joining_date ?? null,
                'time_tracking' => [
                    'total_worked_hours' => 0.00,
                    'total_productive_hours' => 0.00,
                    'activity_percentage' => 0.00,
                    'productivity_score' => 0.00,
                ],
                'payroll_status' => [
                    'is_processed' => false,
                    'net_pay' => 0.00,
                    'payment_status' => 'pending',
                    'gross_salary' => 0.00,
                    'total_deductions' => 0.00,
                ],
                'has_template' => true,
                'template_id' => $template->id,
                'annual_ctc' => (float) ($template->annual_ctc ?? 0),
                'basic_percentage' => (float) ($template->basic_percentage ?? 40.00),
                'hra_percentage' => (float) ($template->hra_percentage ?? 50.00),
                'conveyance_allowance' => (float) ($template->conveyance_allowance ?? 1600.00),
                'pf_enabled' => (bool) $template->pf_enabled,
                'esi_enabled' => (bool) $template->esi_enabled,
                'pt_enabled' => (bool) $template->pt_enabled,
                'tds_enabled' => (bool) $template->tds_enabled,
            ];
        });
        
        return response()->json([
            'success' => true,
            'department_id' => $departmentId,
            'employees' => $employees,
            'total_count' => $employees->count(),
            'sample_employee' => $employees->first(),
        ]);
    }
    
    /**
     * Get raw data without transformation
     */
    public function rawData(Request $request, int $departmentId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        
        $userIds = DB::table('group_user')
            ->where('group_id', $departmentId)
            ->pluck('user_id');
        
        $users = \App\Models\User::where('organization_id', $organizationId)
            ->whereIn('id', $userIds)
            ->get();
        
        return response()->json([
            'user_ids' => $userIds,
            'users' => $users,
            'count' => $users->count(),
        ]);
    }
}
