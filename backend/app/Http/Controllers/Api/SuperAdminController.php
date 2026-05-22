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
            ->with('stats')
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
        
        // Add plan info as subscription data for frontend compatibility
        $organizations->getCollection()->transform(function ($org) {
            $org->subscription = [
                'status' => $org->subscription_status,
                'plan' => [
                    'name' => $org->plan_code ?? 'No Plan',
                    'price' => 0, // Can be updated if needed
                ],
            ];
            return $org;
        });
        
        return response()->json($organizations);
    }
    
    /**
     * Get single organization details
     */
    public function showOrganization(Request $request, Organization $organization)
    {
        $organization->load([
            'stats',
            'owner' => function($query) {
                $query->select('id', 'name', 'email', 'role');
            }
        ]);
        
        $organization->users_count = $organization->users()->count();
        $organization->active_users_count = $organization->users()->where('email_verified_at', '!=', null)->count();
        
        // Add subscription data for frontend compatibility
        $organization->subscription = [
            'status' => $organization->subscription_status,
            'plan' => [
                'name' => $organization->plan_code ?? 'No Plan',
                'price' => 0,
            ],
        ];
        
        // Add profile fields with null-safe fallbacks
        $organization->subscription_plan = $organization->plan_code;
        $organization->subscription_start_date = $organization->trial_starts_at;
        $organization->subscription_end_date = $organization->trial_ends_at;
        
        return response()->json([
            'success' => true,
            'data' => $organization
        ]);
    }

    /**
     * Create organization manually (for direct sales/enterprise deals)
     */
    public function createOrganization(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'slug' => 'nullable|string|max:255|unique:organizations,slug',
            'description' => 'nullable|string|max:1000',
            'website' => 'nullable|url|max:255',
            'industry' => 'nullable|string|max:100',
            'size' => 'nullable|string|max:50',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:255',
            'address_line' => 'nullable|string|max:255',
            'city' => 'nullable|string|max:100',
            'state' => 'nullable|string|max:100',
            'postal_code' => 'nullable|string|max:20',
            'country' => 'nullable|string|max:100',
            'plan_code' => 'required|string|in:basic,advanced_tracker,growth,enterprise',
            'seats' => 'required|integer|min:1|max:1000',
            'admin_name' => 'required|string|max:255',
            'admin_email' => 'required|email|max:255|unique:users,email',
            'admin_password' => 'required|string|min:8',
            'subscription_status' => 'required|string|in:active,trial',
            'send_welcome_email' => 'nullable|boolean',
        ]);

        $result = DB::transaction(function () use ($validated) {
            // Generate slug if not provided
            $slug = $validated['slug'] ?? $this->generateOrganizationSlug($validated['name']);

            // Create organization
            $organization = Organization::create([
                'name' => $validated['name'],
                'slug' => $slug,
                'description' => $validated['description'] ?? null,
                'website' => $validated['website'] ?? null,
                'industry' => $validated['industry'] ?? null,
                'size' => $validated['size'] ?? null,
                'phone' => $validated['phone'] ?? null,
                'email' => $validated['email'] ?? null,
                'address_line' => $validated['address_line'] ?? null,
                'city' => $validated['city'] ?? null,
                'state' => $validated['state'] ?? null,
                'postal_code' => $validated['postal_code'] ?? null,
                'country' => $validated['country'] ?? null,
                'plan_code' => $validated['plan_code'],
                'billing_cycle' => 'monthly',
                'subscription_status' => $validated['subscription_status'],
                'subscription_intent' => 'paid',
                'max_seats' => $validated['seats'],
                'trial_starts_at' => $validated['subscription_status'] === 'trial' ? now() : null,
                'trial_ends_at' => $validated['subscription_status'] === 'trial' ? now()->addDays(14) : null,
            ]);

            // Create admin user
            $user = User::create([
                'name' => $validated['admin_name'],
                'email' => $validated['admin_email'],
                'password' => bcrypt($validated['admin_password']),
                'role' => 'admin',
                'organization_id' => $organization->id,
                'email_verified_at' => now(), // Auto-verify since super admin created it
            ]);

            // Set organization owner
            $organization->forceFill([
                'owner_user_id' => $user->id,
            ])->save();

            // Create organization stats record
            OrganizationStats::create([
                'organization_id' => $organization->id,
            ]);

            // Send welcome email if requested
            if ($validated['send_welcome_email'] ?? true) {
                $this->sendManualOrganizationWelcomeEmail($user, $organization, $validated['admin_password']);
            }

            return [
                'organization' => $organization,
                'user' => $user,
                'temp_password' => $validated['admin_password'],
            ];
        });

        return response()->json([
            'success' => true,
            'message' => 'Organization created successfully',
            'data' => [
                'organization' => $result['organization'],
                'admin' => [
                    'id' => $result['user']->id,
                    'name' => $result['user']->name,
                    'email' => $result['user']->email,
                ],
                'temp_password' => $result['temp_password'],
                'login_url' => config('app.frontend_url') . '/login',
            ],
        ], 201);
    }

    /**
     * Generate unique organization slug
     */
    private function generateOrganizationSlug(string $name): string
    {
        $baseSlug = \Illuminate\Support\Str::slug($name);
        $slug = $baseSlug ?: 'organization';
        $suffix = 1;

        while (Organization::where('slug', $slug)->exists()) {
            $slug = ($baseSlug ?: 'organization') . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }

    /**
     * Send welcome email for manually created organization
     */
    private function sendManualOrganizationWelcomeEmail(User $user, Organization $organization, string $tempPassword): void
    {
        try {
            $loginUrl = config('app.frontend_url') . '/login';

            \Illuminate\Support\Facades\Mail::to($user->email)->send(new \App\Mail\ManualOrganizationWelcome(
                $user,
                $organization,
                $tempPassword,
                $loginUrl
            ));
        } catch (\Throwable $e) {
            // Log error but don't fail the creation
            \Illuminate\Support\Facades\Log::warning('Failed to send manual organization welcome email', [
                'user_id' => $user->id,
                'email' => $user->email,
                'error' => $e->getMessage(),
            ]);
        }
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
        // Plan prices in INR
        $planPrices = [
            'basic' => 999,
            'advanced_tracker' => 1999,
            'starter' => 999,
            'growth' => 2499,
            'enterprise' => 4999,
            'super_admin' => 0,
        ];
        
        // Get organizations with subscription data
        $subscriptions = Organization::query()
            ->select(
                'id',
                'name as organization_name',
                'plan_code as plan_name',
                'subscription_status as status',
                'trial_starts_at as current_period_start',
                'trial_ends_at as current_period_end',
                'created_at'
            )
            ->orderBy('created_at', 'desc')
            ->paginate($request->get('per_page', 20));
        
        // Add plan prices to each subscription
        $subscriptions->getCollection()->transform(function ($sub) use ($planPrices) {
            $sub->plan_price = $planPrices[$sub->plan_name] ?? 999;
            return $sub;
        });
        
        return response()->json($subscriptions);
    }
    
    /**
     * Get revenue analytics
     */
    public function revenue(Request $request)
    {
        // Define plan prices in INR (Indian Rupees)
        // These are example prices - adjust as needed
        $planPrices = [
            'basic' => 999,
            'advanced_tracker' => 1999,
            'starter' => 999,
            'growth' => 2499,
            'enterprise' => 4999,
            'super_admin' => 0, // Internal use
        ];
        
        // Get active organizations with their plans
        $activeOrgs = Organization::where('subscription_status', 'active')->get();
        
        // Calculate MRR based on plan codes
        $mrr = 0;
        $revenueByPlan = [];
        
        foreach ($activeOrgs as $org) {
            $planCode = $org->plan_code ?? 'starter';
            $price = $planPrices[$planCode] ?? 29;
            $mrr += $price;
            
            if (!isset($revenueByPlan[$planCode])) {
                $revenueByPlan[$planCode] = [
                    'name' => ucfirst($planCode),
                    'count' => 0,
                    'revenue' => 0,
                ];
            }
            $revenueByPlan[$planCode]['count']++;
            $revenueByPlan[$planCode]['revenue'] += $price;
        }
        
        // New subscriptions this month (organizations created this month)
        $newThisMonth = Organization::where('created_at', '>=', now()->startOfMonth())->count();
        
        // Canceled this month (organizations with cancelled status updated this month)
        $canceledThisMonth = Organization::where('subscription_status', 'cancelled')
            ->where('updated_at', '>=', now()->startOfMonth())
            ->count();
        
        // Total counts
        $totalPaid = $activeOrgs->count();
        $totalTrialing = Organization::where('subscription_status', 'trial')->count();
        $totalPastDue = Organization::where('subscription_status', 'past_due')->count();
        $totalUsers = User::count();
        
        return response()->json([
            'data' => [
                'total_revenue' => $mrr * 12, // Annual revenue estimate
                'monthly_recurring_revenue' => $mrr,
                'revenue_growth' => 0, // Would calculate based on historical data
                'total_paid_subscriptions' => $totalPaid,
                'total_trialing_subscriptions' => $totalTrialing,
                'total_past_due_subscriptions' => $totalPastDue,
                'average_revenue_per_user' => $totalUsers > 0 ? round($mrr / $totalUsers, 2) : 0,
            ]
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
            ->select('id', 'name', 'created_at', 'subscription_status')
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
    
    /**
     * Export organizations to Excel
     */
    public function exportOrganizations(Request $request)
    {
        $query = Organization::query()
            ->with('owner:id,name,email')
            ->withCount('users');
        
        // Filter by status
        if ($request->has('status')) {
            $query->where('subscription_status', $request->status === 'active' ? 'active' : 'cancelled');
        }
        
        // Search by name
        if ($request->has('search')) {
            $query->where('name', 'like', '%' . $request->search . '%');
        }
        
        $organizations = $query->orderBy('created_at', 'desc')->get();
        
        // Create CSV content
        $headers = ['ID', 'Name', 'Slug', 'Plan', 'Status', 'Users Count', 'Owner Name', 'Owner Email', 'Created At'];
        
        $callback = function() use ($organizations, $headers) {
            $file = fopen('php://output', 'w');
            
            // Write headers
            fputcsv($file, $headers);
            
            // Write data
            foreach ($organizations as $org) {
                fputcsv($file, [
                    $org->id,
                    $org->name,
                    $org->slug,
                    $org->plan_code ?? 'No Plan',
                    $org->subscription_status,
                    $org->users_count,
                    $org->owner?->name ?? 'N/A',
                    $org->owner?->email ?? 'N/A',
                    $org->created_at->format('Y-m-d H:i:s'),
                ]);
            }
            
            fclose($file);
        };
        
        return response()->stream($callback, 200, [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => 'attachment; filename="organizations_' . now()->format('Y-m-d') . '.csv"',
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
            'Pragma' => 'no-cache',
            'Expires' => '0',
        ]);
    }
    
    /**
     * Global search across all entities
     */
    public function globalSearch(Request $request)
    {
        $query = $request->get('q', '');
        
        if (empty($query) || strlen($query) < 2) {
            return response()->json([
                'success' => true,
                'data' => []
            ]);
        }
        
        $results = [];
        
        // Search organizations
        $organizations = Organization::where('name', 'like', '%' . $query . '%')
            ->orWhere('slug', 'like', '%' . $query . '%')
            ->limit(10)
            ->get();
            
        foreach ($organizations as $org) {
            $results[] = [
                'type' => 'organization',
                'id' => $org->id,
                'title' => $org->name,
                'subtitle' => $org->slug,
                'status' => $org->subscription_status,
                'url' => '/super-admin/organizations/' . $org->id,
            ];
        }
        
        // Search users
        $users = User::where('name', 'like', '%' . $query . '%')
            ->orWhere('email', 'like', '%' . $query . '%')
            ->with('organization:id,name')
            ->limit(10)
            ->get();
            
        foreach ($users as $user) {
            $results[] = [
                'type' => 'user',
                'id' => $user->id,
                'title' => $user->name,
                'subtitle' => $user->email . ($user->organization ? ' • ' . $user->organization->name : ''),
                'status' => $user->email_verified_at ? 'active' : 'inactive',
                'url' => '/super-admin/users',
            ];
        }
        
        return response()->json([
            'success' => true,
            'data' => $results,
            'meta' => [
                'total' => count($results),
                'query' => $query,
            ]
        ]);
    }
}
