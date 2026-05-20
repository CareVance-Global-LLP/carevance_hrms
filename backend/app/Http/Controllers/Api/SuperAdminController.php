<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Organization;
use App\Models\OrganizationStats;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SuperAdminController extends Controller
{
    /**
     * Get all organizations with stats
     */
    public function organizations(Request $request)
    {
        $query = Organization::query()
            ->with(['subscription.plan', 'stats'])
            ->withCount('users');
        
        // Filter by status
        if ($request->has('status')) {
            $query->where('subscription_status', $request->status === 'active' ? 'active' : 'cancelled');
        }
        
        // Search by name
        if ($request->has('search')) {
            $query->where('name', 'like', '%' . $request->search . '%');
        }
        
        // Sort
        $sortBy = $request->get('sort_by', 'created_at');
        $sortOrder = $request->get('sort_order', 'desc');
        $query->orderBy($sortBy, $sortOrder);
        
        $organizations = $query->paginate($request->get('per_page', 20));
        
        return response()->json($organizations);
    }
    
    /**
     * Get single organization details
     */
    public function showOrganization(Request $request, Organization $organization)
    {
        $organization->load([
            'subscription.plan',
            'stats',
            'owner' => function($query) {
                $query->select('id', 'name', 'email', 'role');
            }
        ]);
        
        $organization->users_count = $organization->users()->count();
        $organization->active_users_count = $organization->users()->where('email_verified_at', '!=', null)->count();
        
        return response()->json([
            'success' => true,
            'data' => $organization
        ]);
    }
    
    /**
     * Toggle organization status (active/inactive)
     */
    public function toggleStatus(Request $request, Organization $organization)
    {
        $isActive = $organization->subscription_status === 'active';
        $organization->subscription_status = $isActive ? 'cancelled' : 'active';
        $organization->save();
        
        return response()->json([
            'success' => true,
            'message' => 'Organization ' . ($organization->subscription_status === 'active' ? 'activated' : 'suspended'),
            'data' => [
                'id' => $organization->id,
                'subscription_status' => $organization->subscription_status
            ]
        ]);
    }
    
    /**
     * Delete organization (soft delete)
     */
    public function deleteOrganization(Request $request, Organization $organization)
    {
        // Delete all related data
        $organization->users()->delete();
        $organization->subscription?->delete();
        $organization->stats?->delete();
        $organization->delete();
        
        return response()->json([
            'success' => true,
            'message' => 'Organization deleted successfully'
        ]);
    }
    
    /**
     * Get all users across all organizations
     */
    public function allUsers(Request $request)
    {
        $query = User::query()
            ->with('organization:id,name')
            ->select('id', 'name', 'email', 'role', 'organization_id', 'created_at', 'email_verified_at');
        
        // Filter by organization
        if ($request->has('organization_id')) {
            $query->where('organization_id', $request->organization_id);
        }
        
        // Search
        if ($request->has('search')) {
            $query->where(function($q) use ($request) {
                $q->where('name', 'like', '%' . $request->search . '%')
                  ->orWhere('email', 'like', '%' . $request->search . '%');
            });
        }
        
        // Filter by role
        if ($request->has('role')) {
            $query->where('role', $request->role);
        }
        
        $users = $query->paginate($request->get('per_page', 20));
        
        return response()->json($users);
    }
    
    /**
     * Get subscriptions overview
     */
    public function subscriptions(Request $request)
    {
        $subscriptions = DB::table('organization_subscriptions')
            ->join('organizations', 'organization_subscriptions.organization_id', '=', 'organizations.id')
            ->join('plans', 'organization_subscriptions.plan_id', '=', 'plans.id')
            ->select(
                'organizations.name as organization_name',
                'plans.name as plan_name',
                'organization_subscriptions.status',
                'organization_subscriptions.current_period_start',
                'organization_subscriptions.current_period_end',
                'organization_subscriptions.created_at'
            )
            ->orderBy('organization_subscriptions.created_at', 'desc')
            ->paginate($request->get('per_page', 20));
        
        return response()->json($subscriptions);
    }
    
    /**
     * Get revenue analytics
     */
    public function revenue(Request $request)
    {
        // Total MRR
        $mrr = DB::table('organization_subscriptions')
            ->join('plans', 'organization_subscriptions.plan_id', '=', 'plans.id')
            ->where('organization_subscriptions.status', 'active')
            ->sum('plans.price');
        
        // Revenue by plan
        $revenueByPlan = DB::table('organization_subscriptions')
            ->join('plans', 'organization_subscriptions.plan_id', '=', 'plans.id')
            ->where('organization_subscriptions.status', 'active')
            ->select('plans.name', DB::raw('COUNT(*) as count'), DB::raw('SUM(plans.price) as revenue'))
            ->groupBy('plans.name')
            ->get();
        
        // New subscriptions this month
        $newThisMonth = DB::table('organization_subscriptions')
            ->where('created_at', '>=', now()->startOfMonth())
            ->count();
        
        // Canceled this month
        $canceledThisMonth = DB::table('organization_subscriptions')
            ->where('canceled_at', '>=', now()->startOfMonth())
            ->count();
        
        return response()->json([
            'mrr' => $mrr,
            'annual_run_rate' => $mrr * 12,
            'revenue_by_plan' => $revenueByPlan,
            'new_this_month' => $newThisMonth,
            'canceled_this_month' => $canceledThisMonth
        ]);
    }
    
    /**
     * Get system-wide statistics
     */
    public function stats(Request $request)
    {
        $stats = [
            'total_organizations' => Organization::count(),
            'active_organizations' => Organization::where('subscription_status', 'active')->count(),
            'suspended_organizations' => Organization::whereIn('subscription_status', ['cancelled', 'expired'])->count(),
            
            'total_users' => User::count(),
            'active_users' => User::where('email_verified_at', '!=', null)->count(),
            
            'users_by_role' => [
                'admin' => User::where('role', 'admin')->count(),
                'manager' => User::where('role', 'manager')->count(),
                'employee' => User::where('role', 'employee')->count(),
            ],
            
            'new_signups_today' => Organization::whereDate('created_at', today())->count(),
            'new_signups_this_week' => Organization::where('created_at', '>=', now()->startOfWeek())->count(),
            'new_signups_this_month' => Organization::where('created_at', '>=', now()->startOfMonth())->count(),
            
            'active_subscriptions' => Organization::where('subscription_status', 'active')->count(),
            'trialing_subscriptions' => Organization::where('subscription_status', 'trial')->count(),
            'past_due_subscriptions' => 0,
        ];
        
        // Recent organizations (last 5)
        $stats['recent_organizations'] = Organization::query()
            ->select('id', 'name', 'created_at')
            ->orderBy('created_at', 'desc')
            ->limit(5)
            ->get();
        
        return response()->json([
            'success' => true,
            'data' => $stats
        ]);
    }
    
    /**
     * Impersonate a user (login as them)
     */
    public function impersonate(Request $request, User $user)
    {
        // Create impersonation token
        $token = $user->createToken('impersonation-' . now()->timestamp)->plainTextToken;
        
        return response()->json([
            'success' => true,
            'message' => 'Impersonation token created',
            'data' => [
                'token' => $token,
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'organization' => $user->organization?->name
                ]
            ]
        ]);
    }
}
