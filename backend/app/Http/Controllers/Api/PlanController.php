<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PlanController extends Controller
{
    /**
     * Get all plans
     */
    public function index()
    {
        $plans = Plan::orderBy('price_monthly')->get();
        
        return response()->json([
            'success' => true,
            'data' => $plans
        ]);
    }
    
    /**
     * Get plan by code
     */
    public function show($code)
    {
        $plan = Plan::where('code', $code)->firstOrFail();
        
        return response()->json([
            'success' => true,
            'data' => $plan
        ]);
    }
    
    /**
     * Create new plan
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'code' => 'required|string|unique:plans,code',
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'price_monthly' => 'required|numeric|min:0',
            'price_yearly' => 'nullable|numeric|min:0',
            'max_employees' => 'required|integer|min:1',
            'features' => 'nullable|array',
            'is_active' => 'boolean',
            'is_popular' => 'boolean',
            'display_order' => 'nullable|integer',
        ]);
        
        $plan = Plan::create($validated);
        
        return response()->json([
            'success' => true,
            'message' => 'Plan created successfully',
            'data' => $plan
        ], 201);
    }
    
    /**
     * Update plan
     */
    public function update(Request $request, $code)
    {
        $plan = Plan::where('code', $code)->firstOrFail();
        
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'description' => 'nullable|string',
            'price_monthly' => 'sometimes|numeric|min:0',
            'price_yearly' => 'nullable|numeric|min:0',
            'max_employees' => 'sometimes|integer|min:1',
            'features' => 'nullable|array',
            'is_active' => 'boolean',
            'is_popular' => 'boolean',
            'display_order' => 'nullable|integer',
        ]);
        
        $plan->update($validated);
        
        return response()->json([
            'success' => true,
            'message' => 'Plan updated successfully',
            'data' => $plan
        ]);
    }
    
    /**
     * Delete plan
     */
    public function destroy($code)
    {
        $plan = Plan::where('code', $code)->firstOrFail();
        
        // Check if any organizations are using this plan
        $usageCount = Organization::where('plan_code', $code)->count();
        if ($usageCount > 0) {
            return response()->json([
                'success' => false,
                'message' => "Cannot delete plan. It is currently used by {$usageCount} organization(s)."
            ], 400);
        }
        
        $plan->delete();
        
        return response()->json([
            'success' => true,
            'message' => 'Plan deleted successfully'
        ]);
    }
    
    /**
     * Get plan comparison matrix
     */
    public function comparison()
    {
        $plans = Plan::where('is_active', true)
            ->orderBy('display_order')
            ->orderBy('price_monthly')
            ->get();
        
        // Define all possible features
        $allFeatures = [
            'attendance' => 'Attendance Tracking',
            'leave_management' => 'Leave Management',
            'basic_reports' => 'Basic Reports',
            'payroll' => 'Payroll Management',
            'advanced_reports' => 'Advanced Reports',
            'project_tracking' => 'Project Tracking',
            'screenshots' => 'Screenshots',
            'productivity_tracking' => 'Productivity Tracking',
            'browser_tracking' => 'Browser Tracking',
            'chat' => 'Team Chat',
            'api_access' => 'API Access',
            'priority_support' => 'Priority Support',
            'custom_integrations' => 'Custom Integrations',
            'white_label' => 'White Label',
        ];
        
        $matrix = [];
        foreach ($allFeatures as $key => $label) {
            $row = [
                'feature_key' => $key,
                'feature_name' => $label,
            ];
            
            foreach ($plans as $plan) {
                $features = $plan->features ?? [];
                $row[$plan->code] = in_array($key, $features);
            }
            
            $matrix[] = $row;
        }
        
        return response()->json([
            'success' => true,
            'data' => [
                'plans' => $plans,
                'features' => $allFeatures,
                'matrix' => $matrix,
            ]
        ]);
    }
    
    /**
     * Toggle feature for a plan
     */
    public function toggleFeature(Request $request, $code)
    {
        $plan = Plan::where('code', $code)->firstOrFail();
        
        $validated = $request->validate([
            'feature' => 'required|string',
            'enabled' => 'required|boolean',
        ]);
        
        $features = $plan->features ?? [];
        
        if ($validated['enabled']) {
            if (!in_array($validated['feature'], $features)) {
                $features[] = $validated['feature'];
            }
        } else {
            $features = array_diff($features, [$validated['feature']]);
        }
        
        $plan->update(['features' => $features]);
        
        return response()->json([
            'success' => true,
            'message' => 'Feature updated successfully',
            'data' => $plan
        ]);
    }
}
