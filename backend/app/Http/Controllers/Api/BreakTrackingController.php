<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\BreakTime;
use App\Models\TimeEntry;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BreakTrackingController extends Controller
{
    public function today(Request $request): JsonResponse
    {
        $user = $request->user();
        $today = now()->toDateString();

        $breaks = BreakTime::with('user:id,name')
            ->where('user_id', $user->id)
            ->where('break_date', $today)
            ->orderBy('start_at')
            ->get();

        $activeBreak = $breaks->first(fn($b) => $b->end_at === null);
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

        $breaks = BreakTime::with('user:id,name')
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
            'reason' => 'nullable|string|max:255',
        ]);

        $user = $request->user();

        $existingActive = BreakTime::where('user_id', $user->id)
            ->whereNull('end_at')
            ->first();

        if ($existingActive) {
            return response()->json(['message' => 'You already have an active break.'], 409);
        }

        $now = now();
        $break = BreakTime::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'break_date' => $now->toDateString(),
            'start_at' => $now,
            'reason' => $request->reason,
        ]);

        $this->stopPrimaryTimer($user->id, $now);

        return response()->json([
            'message' => 'Break started.',
            'break' => $break->load('user:id,name'),
        ], 201);
    }

    public function end(Request $request): JsonResponse
    {
        $user = $request->user();

        $activeBreak = BreakTime::where('user_id', $user->id)
            ->whereNull('end_at')
            ->first();

        if (!$activeBreak) {
            return response()->json(['message' => 'No active break found.'], 404);
        }

        $now = now();
        $durationSeconds = (int) $activeBreak->start_at->diffInSeconds($now);

        $activeBreak->update([
            'end_at' => $now,
            'duration_seconds' => $durationSeconds,
        ]);

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
        $break = BreakTime::findOrFail($id);
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        if ($break->user_id !== $user->id && !$isAdmin) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $break->delete();

        return response()->json(['message' => 'Break entry deleted.']);
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

        if ($runningEntries->isEmpty()) {
            return;
        }

        foreach ($runningEntries as $entry) {
            $entry->update([
                'end_time' => $stoppedAt,
                'duration' => (int) $entry->start_time->diffInSeconds($stoppedAt),
            ]);
        }

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
}
