<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\BreakTime;
use App\Models\BreakType;
use App\Models\TimeEntry;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BreakTrackingController extends Controller
{
    /**
     * The org's break types plus how much of each the user has consumed today,
     * so the picker can show "Lunch · 25/60 min used".
     */
    public function types(Request $request): JsonResponse
    {
        $user = $request->user();
        $types = BreakType::forOrganization((int) $user->organization_id);

        $usedSecondsByType = TimeEntry::query()
            ->where('user_id', $user->id)
            ->where('is_break', true)
            ->whereNotNull('break_type_id')
            ->whereDate('start_time', now()->toDateString())
            ->selectRaw('break_type_id, SUM(COALESCE(duration, 0)) as used_seconds')
            ->groupBy('break_type_id')
            ->pluck('used_seconds', 'break_type_id');

        return response()->json([
            'types' => $types->map(fn (BreakType $type) => [
                'id' => $type->id,
                'name' => $type->name,
                'is_paid' => $type->is_paid,
                'max_minutes_per_day' => $type->max_minutes_per_day,
                'used_seconds_today' => (int) ($usedSecondsByType[$type->id] ?? 0),
            ])->values(),
        ]);
    }

    /** Admin-only: create a break type for the organization. */
    public function storeType(Request $request): JsonResponse
    {
        if ($forbidden = $this->forbidUnlessAdmin($request)) {
            return $forbidden;
        }

        $validated = $request->validate([
            'name' => 'required|string|max:80',
            'is_paid' => 'required|boolean',
            'max_minutes_per_day' => 'nullable|integer|min:1|max:1440',
        ]);

        $type = BreakType::create([
            'organization_id' => $request->user()->organization_id,
            'name' => $validated['name'],
            'is_paid' => (bool) $validated['is_paid'],
            'max_minutes_per_day' => $validated['max_minutes_per_day'] ?? null,
        ]);

        return response()->json($type, 201);
    }

    /** Admin-only: update a break type. Org-scoped lookup, never findOrFail on the bare id. */
    public function updateType(Request $request, int $id): JsonResponse
    {
        if ($forbidden = $this->forbidUnlessAdmin($request)) {
            return $forbidden;
        }

        $type = BreakType::where('organization_id', $request->user()->organization_id)->findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|string|max:80',
            'is_paid' => 'sometimes|boolean',
            'max_minutes_per_day' => 'nullable|integer|min:1|max:1440',
            'is_active' => 'sometimes|boolean',
        ]);

        $type->update($validated);

        return response()->json($type->fresh());
    }

    /**
     * Admin-only: deactivate a break type. Soft — historical entries keep their
     * type for reporting; the type just stops being offered.
     */
    public function destroyType(Request $request, int $id): JsonResponse
    {
        if ($forbidden = $this->forbidUnlessAdmin($request)) {
            return $forbidden;
        }

        $type = BreakType::where('organization_id', $request->user()->organization_id)->findOrFail($id);
        $type->update(['is_active' => false]);

        return response()->json(['message' => 'Break type deactivated.']);
    }

    private function forbidUnlessAdmin(Request $request): ?JsonResponse
    {
        $user = $request->user();

        if (! $user || $user->getHierarchyLevel() > 10) {
            return response()->json(['message' => 'Only admins can manage break types.'], 403);
        }

        return null;
    }

    public function today(Request $request): JsonResponse
    {
        $user = $request->user();
        $today = now()->toDateString();

        $this->closeStaleOpenBreaks((int) $user->id, $today);

        $breaks = BreakTime::with(['user:id,name', 'breakType:id,name,is_paid'])
            ->where('user_id', $user->id)
            ->where('break_date', $today)
            ->orderBy('start_at')
            ->get();

        $activeBreak = $breaks->first(fn ($b) => $b->end_at === null);
        $totalBreakSeconds = $breaks->whereNotNull('end_at')->sum('duration_seconds');

        return response()->json([
            'breaks' => $breaks,
            'active_break' => $activeBreak,
            'total_break_seconds' => $totalBreakSeconds,
        ]);
    }

    public function history(Request $request): JsonResponse
    {
        $request->validate([
            'date' => 'nullable|date',
            'user_id' => 'nullable|integer|exists:users,id',
        ]);

        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $targetUserId = $isAdmin && $request->user_id ? $request->user_id : $user->id;
        $date = $request->get('date', now()->toDateString());

        // Org scope: without it the admin branch above reads any user_id in any
        // organization, since the only gate was a bare role check.
        $breaks = BreakTime::with('user:id,name')
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $targetUserId)
            ->where('break_date', $date)
            ->orderBy('start_at')
            ->get();

        $totalSeconds = $breaks->whereNotNull('end_at')->sum('duration_seconds');

        return response()->json([
            'breaks' => $breaks,
            'total_break_seconds' => $totalSeconds,
            'user_id' => (int) $targetUserId,
            'date' => $date,
        ]);
    }

    public function start(Request $request): JsonResponse
    {
        $request->validate([
            // reason is legacy free text, kept so old desktop builds keep
            // working. New clients send break_type_id.
            'reason' => 'nullable|string|max:255',
            'break_type_id' => 'nullable|integer',
        ]);

        $user = $request->user();
        $now = now();
        $today = $now->toDateString();

        $breakType = null;
        if ($request->filled('break_type_id')) {
            // Org-scoped and active-only: a foreign org's id or a deactivated
            // type must behave like an invalid one, not leak through.
            $breakType = BreakType::query()
                ->where('organization_id', $user->organization_id)
                ->active()
                ->find((int) $request->input('break_type_id'));

            if (! $breakType) {
                return response()->json(['message' => 'Invalid break type.'], 422);
            }
        }

        $this->closeStaleOpenBreaks((int) $user->id, $today);

        // Date-scoped on purpose. The unscoped check used to 409 forever against
        // an orphaned row left open by a cron that force-closed the time entry
        // but knew nothing about break_times — and today() filters by date, so
        // the stale break was invisible in the UI and there was no End button to
        // clear it. closeStaleOpenBreaks() above heals those rows; this keeps the
        // guard to the day the user is actually working.
        $existingActive = BreakTime::where('user_id', $user->id)
            ->whereNull('end_at')
            ->where('break_date', $today)
            ->first();

        if ($existingActive) {
            return response()->json(['message' => 'You already have an active break.'], 409);
        }

        $breakLabel = $breakType?->name ?? $request->reason;

        $break = DB::transaction(function () use ($user, $now, $today, $breakType, $breakLabel) {
            // The parallel is_break TimeEntry makes the break visible natively in
            // the time-entries table and in attendance worked-time calculations.
            $breakEntry = TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'break',
                'start_time' => $now,
                'is_break' => true,
                'break_type_id' => $breakType?->id,
                'description' => $breakLabel ? "Break — {$breakLabel}" : 'Break',
            ]);

            $break = BreakTime::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'time_entry_id' => $breakEntry->id,
                'break_type_id' => $breakType?->id,
                'break_date' => $today,
                'start_at' => $now,
                'reason' => $breakLabel,
            ]);

            $this->stopPrimaryTimer($user->id, $now);

            return $break;
        });

        return response()->json([
            'message' => 'Break started.',
            'break' => $break->load(['user:id,name', 'breakType:id,name,is_paid']),
            'break_entry_id' => $break->time_entry_id,
        ], 201);
    }

    public function end(Request $request): JsonResponse
    {
        $user = $request->user();
        $now = now();

        $this->closeStaleOpenBreaks((int) $user->id, $now->toDateString());

        // Oldest-first, matching how today() picks the active break, so the two
        // endpoints can never disagree about which break is the current one.
        $activeBreak = BreakTime::where('user_id', $user->id)
            ->whereNull('end_at')
            ->orderBy('start_at')
            ->first();

        if (! $activeBreak) {
            return response()->json(['message' => 'No active break found.'], 404);
        }

        DB::transaction(function () use ($activeBreak, $user, $now) {
            $activeBreak->update([
                'end_at' => $now,
                'duration_seconds' => (int) max(0, $activeBreak->start_at->diffInSeconds($now)),
            ]);

            // Resolved through the FK rather than re-queried as "newest open
            // is_break row for this user". The old lookup had no id and no date
            // binding, so after any cron interference it closed a different
            // break than the one being ended, and stamped it with a duration
            // computed from the other row's start.
            $breakEntry = $activeBreak->timeEntry;

            if ($breakEntry && $breakEntry->end_time === null) {
                $breakEntry->update([
                    'end_time' => $now,
                    'duration' => (int) max(0, $breakEntry->start_time->diffInSeconds($now)),
                ]);
            }

            // Resuming work: the break punched attendance out, so it has to
            // punch back in. Nothing did this before, which left anyone who
            // ended a break without also restarting a timer checked out for the
            // rest of the day.
            $this->ensureAttendanceCheckedInAfterBreak((int) $user->id, $now);
        });

        $dayTotal = BreakTime::where('user_id', $user->id)
            ->where('break_date', $activeBreak->break_date)
            ->whereNotNull('end_at')
            ->sum('duration_seconds');

        return response()->json([
            'message' => 'Break ended.',
            'break' => $activeBreak->fresh()->load('user:id,name'),
            'total_break_seconds' => (int) $dayTotal,
        ]);
    }

    public function destroy(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        // Org scope: findOrFail() plus a bare role check let an admin of one
        // organization delete another organization's break.
        $break = BreakTime::where('organization_id', $user->organization_id)
            ->findOrFail($id);

        if ($break->user_id !== $user->id && ! $isAdmin) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        // Both halves, or the is_break entry survives as an orphan that still
        // counts toward break totals everywhere that reads time entries.
        DB::transaction(function () use ($break) {
            $break->timeEntry?->delete();
            $break->delete();
        });

        return response()->json(['message' => 'Break entry deleted.']);
    }

    /**
     * Heal breaks left open past their own day. A cron that force-closes the
     * is_break time entry knows nothing about break_times, so its row stays
     * open forever and permanently 409s the user out of break tracking. Close
     * them at the paired entry's end_time when we have it, otherwise at the end
     * of the day they started.
     */
    private function closeStaleOpenBreaks(int $userId, string $today): void
    {
        $staleBreaks = BreakTime::with('timeEntry')
            ->where('user_id', $userId)
            ->whereNull('end_at')
            ->where('break_date', '<', $today)
            ->get();

        foreach ($staleBreaks as $break) {
            $endAt = $break->timeEntry?->end_time
                ?: $break->start_at->copy()->endOfDay();

            if ($endAt->lt($break->start_at)) {
                $endAt = $break->start_at->copy();
            }

            $break->update([
                'end_at' => $endAt,
                'duration_seconds' => (int) max(0, $break->start_at->diffInSeconds($endAt)),
            ]);
        }
    }

    private function stopPrimaryTimer(int $userId, Carbon $stoppedAt): void
    {
        $runningEntries = TimeEntry::where('user_id', $userId)
            ->whereNull('end_time')
            ->where(function ($query) {
                $query->where('timer_slot', 'primary')
                    ->orWhereNull('timer_slot');
            })
            ->get();

        foreach ($runningEntries as $entry) {
            $entry->update([
                'end_time' => $stoppedAt,
                'duration' => (int) $entry->start_time->diffInSeconds($stoppedAt),
            ]);
        }

        // Unconditional. This used to sit behind an "is there a running timer"
        // early return, and the desktop UI stops the timer before calling
        // /breaks/start — so there was never anything running and attendance was
        // never punched out here. For attendance-only users (who never start a
        // timer at all) the punch kept accruing across the whole break, counted
        // as worked and reported again as break.
        $this->ensureAttendanceCheckedOutForBreak($userId, $stoppedAt);
    }

    private function ensureAttendanceCheckedOutForBreak(int $userId, ?Carbon $checkOutAt = null): void
    {
        $today = now()->toDateString();
        $record = AttendanceRecord::where('user_id', $userId)
            ->whereDate('attendance_date', $today)
            ->first();
        if (!$record) {
            return;
        }

        $openPunch = AttendancePunch::where('attendance_record_id', $record->id)
            ->whereNull('punch_out_at')
            ->orderByDesc('punch_in_at')
            ->first();
        if (!$openPunch) {
            return;
        }

        $checkOutAt = $checkOutAt ?: now();
        $sessionWorkedSeconds = max(0, Carbon::parse($openPunch->punch_in_at)->diffInSeconds($checkOutAt));
        $openPunch->update([
            'punch_out_at' => $checkOutAt,
            'worked_seconds' => (int) $sessionWorkedSeconds,
        ]);

        $closedWorked = (int) AttendancePunch::where('attendance_record_id', $record->id)
            ->whereNotNull('punch_out_at')
            ->sum('worked_seconds');

        $record->update([
            'check_out_at' => $checkOutAt,
            'worked_seconds' => $closedWorked,
            'status' => 'present',
        ]);
    }

    /**
     * Re-open an attendance punch after a break. Deliberately narrower than
     * TimeEntryController::ensureAttendanceCheckedIn: the day is already under
     * way, so there is no leave check and no late-minutes recalculation to do —
     * only the punch needs reopening.
     */
    private function ensureAttendanceCheckedInAfterBreak(int $userId, Carbon $resumedAt): void
    {
        $record = AttendanceRecord::where('user_id', $userId)
            ->whereDate('attendance_date', now()->toDateString())
            ->first();

        if (! $record) {
            return;
        }

        $hasOpenPunch = AttendancePunch::where('attendance_record_id', $record->id)
            ->whereNull('punch_out_at')
            ->exists();

        if ($hasOpenPunch) {
            return;
        }

        AttendancePunch::create([
            'organization_id' => $record->organization_id,
            'user_id' => $userId,
            'attendance_record_id' => $record->id,
            'punch_in_at' => $resumedAt,
        ]);

        $record->update([
            'check_out_at' => null,
            'status' => 'present',
        ]);
    }
}
