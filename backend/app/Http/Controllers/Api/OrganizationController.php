<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Organization;
use App\Services\Invitations\InvitationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrganizationController extends Controller
{
    public function __construct(private readonly InvitationService $invitationService)
    {
    }

    public function index()
    {
        $user = request()->user();
        if (!$user || !$user->organization_id) {
            return response()->json([]);
        }

        $organization = Organization::find($user->organization_id);
        return response()->json($organization ? [$organization] : []);
    }

    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'slug' => 'nullable|string|unique:organizations',
        ]);

        $baseSlug = $request->slug ? Str::slug($request->slug) : Str::slug($request->name);
        $slug = $baseSlug !== '' ? $baseSlug : 'organization';
        $suffix = 1;

        while (Organization::where('slug', $slug)->exists()) {
            $slug = ($baseSlug !== '' ? $baseSlug : 'organization').'-'.$suffix;
            $suffix++;
        }

        $organization = Organization::create([
            'name' => $request->name,
            'slug' => $slug,
        ]);

        if ($request->user()) {
            $request->user()->update(['organization_id' => $organization->id]);
        }

        return response()->json($organization, 201);
    }

    public function show(Organization $organization)
    {
        if (!$this->canAccessOrganization($organization)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json($organization);
    }

    public function update(Request $request, Organization $organization)
    {
        if (!$this->canAccessOrganization($organization)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'slug' => 'sometimes|string|unique:organizations,slug,' . $organization->id,
            'settings' => 'nullable|array',
        ]);

        $organization->update($request->only(['name', 'slug', 'settings']));

        return response()->json($organization);
    }

    public function destroy(Organization $organization)
    {
        if (!$this->canAccessOrganization($organization)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = request()->user();
        if ($user->role !== 'admin' && $organization->owner_user_id !== $user->id) {
            return response()->json(['message' => 'Only the organization owner or admin can delete the organization.'], 403);
        }

        $orgId = $organization->id;

        DB::transaction(function () use ($orgId) {
            DB::table('personal_access_tokens')->where('tokenable_type', 'App\Models\User')->whereIn('tokenable_id', function ($query) use ($orgId) {
                $query->select('id')->from('users')->where('organization_id', $orgId);
            })->delete();

            DB::table('time_entries')->whereIn('user_id', function ($query) use ($orgId) {
                $query->select('id')->from('users')->where('organization_id', $orgId);
            })->delete();

            DB::table('tasks')->whereIn('project_id', function ($query) use ($orgId) {
                $query->select('id')->from('projects')->where('organization_id', $orgId);
            })->delete();

            DB::table('projects')->where('organization_id', $orgId)->delete();
            DB::table('invitations')->where('organization_id', $orgId)->delete();
            DB::table('audit_logs')->where('organization_id', $orgId)->delete();
            DB::table('users')->where('organization_id', $orgId)->delete();
            DB::table('organizations')->where('id', $orgId)->delete();
        });

        return response()->json(['message' => 'Organization and all associated data have been deleted.']);
    }

    public function members(int $id)
    {
        $organization = Organization::findOrFail($id);
        if (!$this->canAccessOrganization($organization)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json(
            \App\Models\User::where('organization_id', $organization->id)
                ->orderBy('created_at', 'desc')
                ->get()
        );
    }

    public function invite(Request $request, int $id)
    {
        $organization = Organization::findOrFail($id);
        if (!$this->canAccessOrganization($organization)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if ($request->exists('department_ids')) {
            $departmentIds = $request->input('department_ids');

            if (! $request->exists('group_ids')) {
                $request->merge([
                    'group_ids' => $departmentIds,
                ]);
            } elseif (is_array($request->input('group_ids')) && is_array($departmentIds)) {
                $request->merge([
                    'group_ids' => array_values(array_unique(array_merge($request->input('group_ids'), $departmentIds))),
                ]);
            }
        }

        $validated = $request->validate([
            'email' => 'required|email',
            'role' => 'required|in:admin,manager,employee,client',
            'settings' => 'nullable|array',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
            'project_ids' => 'nullable|array',
            'project_ids.*' => 'integer',
            'delivery' => 'nullable|in:email,link',
            'expires_in_hours' => 'nullable|integer|min:1|max:720',
        ]);

        $result = $this->invitationService->createBatch($request->user(), $organization, [
            ...$validated,
            'email' => mb_strtolower(trim((string) $validated['email'])),
        ]);

        if (count($result['created']) === 0) {
            $firstFailure = $result['failed'][0]['message'] ?? null;
            return response()->json([
                'message' => $firstFailure ?: 'No invitations were created.',
                'errors' => [
                    'email' => collect($result['failed'])->pluck('message')->values()->all(),
                ],
            ], 422);
        }

        return response()->json([
            'message' => 'Invitation created successfully.',
            'invitation' => $result['created'][0],
            'failed' => $result['failed'],
        ], 201);
    }

    private function canAccessOrganization(Organization $organization): bool
    {
        $user = request()->user();
        return $user && $user->organization_id === $organization->id;
    }
}
