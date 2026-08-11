<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Invitations\AcceptInvitationRequest;
use App\Http\Requests\Api\Invitations\StoreInvitationImportRequest;
use App\Http\Requests\Api\Invitations\StoreInvitationRequest;
use App\Models\Invitation;
use App\Models\Organization;
use App\Services\Authorization\OrganizationRoleService;
use App\Services\Invitations\InvitationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class InvitationController extends Controller
{
    use InteractsWithApiResponses;

    public function __construct(
        private readonly InvitationService $invitationService,
        private readonly OrganizationRoleService $organizationRoleService,
    ) {
    }

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return $this->successResponse([
                'invitations' => [],
            ]);
        }

        if (!$this->organizationRoleService->canManageUsers($user)) {
            abort(403, 'Forbidden');
        }

        $invitations = Invitation::query()
            ->with('organization')
            ->where('organization_id', $user->organization_id)
            ->latest()
            ->limit(50)
            ->get()
            ->map(fn (Invitation $invitation) => $this->invitationService->serialize($invitation))
            ->values();

        return $this->successResponse([
            'invitations' => $invitations,
        ]);
    }

    public function store(StoreInvitationRequest $request)
    {
        $user = $request->user();

        if (!$user || !$user->organization_id) {
            abort(422, 'Organization context is required.');
        }

        $organization = $user->organization()->firstOrFail();

        return $this->storeForOrganization($request, $organization);
    }

    public function import(StoreInvitationImportRequest $request)
    {
        $user = $request->user();

        if (!$user || !$user->organization_id) {
            abort(422, 'Organization context is required.');
        }

        $organization = $user->organization()->firstOrFail();
        $payload = $request->validated();
        $result = $this->invitationService->createBulk($user, $organization, $payload['rows'], [
            'group_ids' => $payload['default_group_ids'] ?? [],
            'project_ids' => $payload['default_project_ids'] ?? [],
            'settings' => $payload['settings'] ?? null,
            'expires_in_hours' => $payload['expires_in_hours'] ?? null,
            'joining_date' => $payload['joining_date'] ?? null,
        ]);
        $createdCount = count($result['created']);

        if ($createdCount === 0) {
            $firstFailure = $result['failed'][0]['message'] ?? null;
            return response()->json([
                'success' => false,
                'message' => $firstFailure ?: 'No invitations were created.',
                'error_code' => 'VALIDATION_ERROR',
                'failed' => $result['failed'],
                'errors' => [
                    'rows' => collect($result['failed'])->pluck('message')->values()->all(),
                ],
            ], 422);
        }

        return $this->createdResponse([
            'invitations' => $result['created'],
            'failed' => $result['failed'],
            'invited_count' => $createdCount,
        ], $createdCount === 1 ? 'Invitation created successfully.' : 'Invitations created successfully.');
    }

    public function resend(Request $request, int $invitation)
    {
        $actor = $this->authorizeInvitationManagement($request);
        $record = $this->findInvitationForActor($actor, $invitation);

        return $this->successResponse([
            'invitation' => $this->invitationService->resend($actor, $record),
        ], 'Invitation sent again.');
    }

    public function destroy(Request $request, int $invitation)
    {
        $actor = $this->authorizeInvitationManagement($request);
        $record = $this->findInvitationForActor($actor, $invitation);

        return $this->successResponse([
            'invitation' => $this->invitationService->serialize($this->invitationService->revoke($record)),
        ], 'Invitation revoked.');
    }

    public function storeLegacy(StoreInvitationRequest $request, int $organizationId)
    {
        $organization = Organization::query()->findOrFail($organizationId);

        return $this->storeForOrganization($request, $organization);
    }

    public function show(string $token)
    {
        $invitation = $this->invitationService->resolveByToken($token);

        return $this->successResponse([
            'invitation' => $this->invitationService->serialize($invitation, $token),
        ]);
    }

    public function accept(AcceptInvitationRequest $request, string $token)
    {
        $invitation = $this->invitationService->resolveByToken($token);
        $user = $this->invitationService->accept($invitation, $request->validated());
        $user->load(['organization', 'groups']);

        // No verification mail is sent here any more: redeeming the token that
        // was emailed to this address already proved the joiner controls it.
        // See the note on `email_verified_at` in InvitationService::accept().
        return $this->createdResponse([
            'user' => $user,
            'organization' => $user->organization,
            'requires_verification' => false,
            'email' => $user->email,
            'verification_email_sent' => false,
        ], 'Invitation accepted successfully. You can sign in now.');
    }

    private function authorizeInvitationManagement(Request $request): \App\Models\User
    {
        $user = $request->user();

        if (!$user || !$user->organization_id) {
            abort(422, 'Organization context is required.');
        }

        if (!$this->organizationRoleService->canManageUsers($user)) {
            abort(403, 'Forbidden');
        }

        return $user;
    }

    /**
     * Resolve an invitation inside the actor's own workspace.
     *
     * `Invitation` carries no tenant scope, so the organization filter is
     * written out here rather than assumed. Without it, an id from another
     * workspace would resolve and be resendable across the tenant boundary.
     */
    private function findInvitationForActor(\App\Models\User $actor, int $invitationId): Invitation
    {
        return Invitation::query()
            ->with(['organization', 'inviter'])
            ->where('organization_id', $actor->organization_id)
            ->where('id', $invitationId)
            ->firstOr(fn () => abort(404, 'This invitation is no longer available.'));
    }

    private function storeForOrganization(StoreInvitationRequest $request, Organization $organization)
    {
        $user = $request->user();

        if (!$user || (int) $user->organization_id !== (int) $organization->id) {
            abort(403, 'Forbidden');
        }

        $result = $this->invitationService->createBatch($user, $organization, $request->validated());
        $createdCount = count($result['created']);

        if ($createdCount === 0) {
            $firstFailure = $result['failed'][0]['message'] ?? null;
            return response()->json([
                'success' => false,
                'message' => $firstFailure ?: 'No invitations were created.',
                'error_code' => 'VALIDATION_ERROR',
                'errors' => [
                    'emails' => collect($result['failed'])->pluck('message')->values()->all(),
                    'email' => $firstFailure ? [$firstFailure] : [],
                ],
            ], 422);
        }

        return $this->createdResponse([
            'invitations' => $result['created'],
            'failed' => $result['failed'],
            'invited_count' => $createdCount,
        ], $createdCount === 1 ? 'Invitation created successfully.' : 'Invitations created successfully.');
    }

}
