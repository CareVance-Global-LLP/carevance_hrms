<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ChecklistItem;
use App\Models\OnboardingJourney;
use App\Models\User;
use App\Services\Lifecycle\ChecklistService;
use App\Services\Lifecycle\OnboardingService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class OnboardingJourneyController extends Controller
{
    public function __construct(
        private readonly OnboardingService $onboarding,
        private readonly ChecklistService $checklists,
    ) {
    }

    private function denyIfNotManager(User $user): ?JsonResponse
    {
        if ($user->getHierarchyLevel() >= 100) {
            return response()->json(['message' => 'Only managers and admins can manage onboarding.'], 403);
        }

        return null;
    }

    public function index(Request $request): JsonResponse
    {
        $user = Auth::user();
        if ($deny = $this->denyIfNotManager($user)) {
            return $deny;
        }

        $query = OnboardingJourney::with([
            'checklistItems',
            'user:id,name,email',
            'manager:id,name',
            'buddy:id,name',
            'group:id,name',
        ])->where('organization_id', $user->organization_id);

        if ($stage = $request->query('stage')) {
            $query->where('stage', $stage);
        }
        if ($request->boolean('open_only')) {
            $query->open();
        }

        return response()->json([
            'data' => $query->orderBy('joining_date')->get(),
        ]);
    }

    /**
     * The signed-in joiner's own onboarding.
     *
     * `index` is staff-only, so without this a new joiner had no way to reach
     * their own journey — they could read it by id and tick their own items,
     * but nothing would tell them the id. This is the endpoint the employee
     * self-service view is built on.
     */
    public function myJourney(): JsonResponse
    {
        $user = Auth::user();

        $journey = OnboardingJourney::with([
            'checklistItems.owner:id,name',
            'checklistItems.document',
            'manager:id,name',
            'buddy:id,name',
            'group:id,name',
        ])
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->latest('id')
            ->first();

        if (! $journey) {
            return response()->json(['data' => null]);
        }

        // Only what this person is responsible for. Seeing that IT has not
        // ordered their laptop is noise to them and pressure on nobody.
        $mine = $journey->checklistItems
            ->where('owner_kind', 'employee')
            ->sortBy('sort_order')
            ->values();

        return response()->json([
            'data' => [
                'journey' => [
                    'id' => $journey->id,
                    'stage' => $journey->stage,
                    // Formatted explicitly: only() hands back the Carbon
                    // instance, which json_encode renders as a UTC datetime and
                    // undoes the date-only cast.
                    'joining_date' => $journey->joining_date?->toDateString(),
                    'days_until_joining' => $journey->days_until_joining,
                    'job_title' => $journey->job_title,
                    'candidate_name' => $journey->candidate_name,
                ],
                'manager' => $journey->manager,
                'buddy' => $journey->buddy,
                'group' => $journey->group,
                'my_items' => $mine,
                'my_progress' => [
                    'total' => $mine->count(),
                    'done' => $mine->filter(fn ($i) => $i->isSettled())->count(),
                    'blocking_outstanding' => $mine
                        ->filter(fn ($i) => $i->is_blocking && ! $i->isSettled())->count(),
                    'overdue' => $mine->filter(fn ($i) => $i->is_overdue)->count(),
                ],
                'readiness' => $journey->readiness,
            ],
        ]);
    }

    public function show(int $id): JsonResponse
    {
        $user = Auth::user();

        $journey = OnboardingJourney::with([
            'checklistItems.owner:id,name',
            'checklistItems.document',
            // Loaded so the journey can show what the profile is still missing
            // rather than only what somebody has ticked off a list.
            'user:id,name,email',
            'user.employeeProfile',
            'user.employeeWorkInfo',
            'user.employeeGovernmentIds',
            'user.employeeBankAccounts',
            'manager:id,name',
            'buddy:id,name',
            'group:id,name',
        ])
            ->where('organization_id', $user->organization_id)
            ->findOrFail($id);

        // A joiner may read their own journey; everyone else needs to be staff.
        if ($journey->user_id !== $user->id && $user->getHierarchyLevel() >= 100) {
            return response()->json(['message' => 'You cannot view this onboarding journey.'], 403);
        }

        return response()->json(['data' => $journey]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = Auth::user();
        if ($deny = $this->denyIfNotManager($user)) {
            return $deny;
        }

        $validated = $request->validate([
            'candidate_name' => 'required|string|max:255',
            'candidate_email' => 'required|email|max:255',
            'joining_date' => 'required|date',
            'job_title' => 'nullable|string|max:255',
            'user_id' => 'nullable|integer|exists:users,id',
            'group_id' => 'nullable|integer|exists:groups,id',
            'manager_id' => 'nullable|integer|exists:users,id',
            'buddy_id' => 'nullable|integer|exists:users,id',
            'notes' => 'nullable|string|max:2000',
        ]);

        $journey = $this->onboarding->open(
            organizationId: $user->organization_id,
            candidateName: $validated['candidate_name'],
            candidateEmail: $validated['candidate_email'],
            joiningDate: Carbon::parse($validated['joining_date']),
            attributes: $validated,
            creator: $user,
        );

        return response()->json([
            'message' => 'Onboarding started for '.$journey->candidate_name.'.',
            'data' => $journey->load(['checklistItems', 'manager:id,name', 'buddy:id,name']),
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $user = Auth::user();
        if ($deny = $this->denyIfNotManager($user)) {
            return $deny;
        }

        $validated = $request->validate([
            'manager_id' => 'nullable|integer|exists:users,id',
            'buddy_id' => 'nullable|integer|exists:users,id',
            'group_id' => 'nullable|integer|exists:groups,id',
            'job_title' => 'nullable|string|max:255',
            'joining_date' => 'nullable|date',
            'notes' => 'nullable|string|max:2000',
            'stage' => 'nullable|in:preboarding,day_one,onboarding,completed,cancelled',
        ]);

        $journey = OnboardingJourney::where('organization_id', $user->organization_id)->findOrFail($id);

        if (isset($validated['stage'])) {
            $journey = $this->onboarding->setStage($journey, $validated['stage']);
        }

        $journey = $this->onboarding->assign($journey, $validated);

        return response()->json([
            'message' => 'Onboarding updated.',
            'data' => $journey->load(['checklistItems', 'manager:id,name', 'buddy:id,name']),
        ]);
    }

    public function completeItem(Request $request, int $id, int $itemId): JsonResponse
    {
        $user = Auth::user();

        $journey = OnboardingJourney::where('organization_id', $user->organization_id)->findOrFail($id);
        $item = ChecklistItem::forSubject($journey)->findOrFail($itemId);

        // A joiner can tick their own items — that is the whole point of
        // preboarding — but not anybody else's.
        $isOwnItem = $journey->user_id === $user->id && $item->owner_kind === 'employee';
        if (! $isOwnItem && $user->getHierarchyLevel() >= 100) {
            return response()->json(['message' => 'You cannot complete this item.'], 403);
        }

        $validated = $request->validate(['notes' => 'nullable|string|max:2000']);

        return response()->json([
            'message' => 'Item completed.',
            'data' => $this->checklists->complete($item, $user, $validated['notes'] ?? null),
            'readiness' => $journey->fresh()->readiness,
        ]);
    }

    public function reopenItem(int $id, int $itemId): JsonResponse
    {
        $user = Auth::user();
        if ($deny = $this->denyIfNotManager($user)) {
            return $deny;
        }

        $journey = OnboardingJourney::where('organization_id', $user->organization_id)->findOrFail($id);
        $item = ChecklistItem::forSubject($journey)->findOrFail($itemId);

        return response()->json([
            'message' => 'Item reopened.',
            'data' => $this->checklists->reopen($item),
            'readiness' => $journey->fresh()->readiness,
        ]);
    }
}
