<?php

namespace App\Http\Controllers\Api;

use App\Support\MonthYear;
use App\Http\Controllers\Controller;
use App\Models\AttendanceHoliday;
use App\Models\User;
use App\Services\Audit\AuditLogService;
use Carbon\Carbon;
use Illuminate\Http\Request;

class AttendanceHolidayController extends Controller
{
    public function __construct(
        private readonly AuditLogService $auditLogService,
    ) {
    }

    public function index(Request $request)
    {
        $request->validate([
            'month' => ['nullable', 'regex:/^\d{4}\-\d{2}$/'],
            'country' => 'nullable|string|max:64',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }

        $month = $request->get('month', now()->format('Y-m'));
        $monthStart = MonthYear::start($month);
        $monthEnd = $monthStart->copy()->endOfMonth();

        $query = AttendanceHoliday::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereBetween('holiday_date', [$monthStart->toDateString(), $monthEnd->toDateString()]);

        if (!$this->canManage($currentUser)) {
            $viewerCountry = AttendanceHoliday::countryForSettings($currentUser->settings);
            $query->whereIn('country', ['ALL', $viewerCountry]);
        } elseif ($request->filled('country')) {
            $query->where('country', AttendanceHoliday::normalizeCountry((string) $request->country));
        }

        return response()->json([
            'data' => $query
                ->orderBy('holiday_date')
                ->orderBy('country')
                ->get(),
        ]);
    }

    public function upsert(Request $request)
    {
        $request->validate([
            'holiday_date' => 'required|date',
            'country' => 'nullable|string|max:64',
            'title' => 'required|string|max:255',
            'details' => 'nullable|string|max:5000',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!$this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $holidayDate = Carbon::parse((string) $request->holiday_date)->toDateString();
        $country = AttendanceHoliday::normalizeCountry((string) $request->country);
        $details = trim((string) $request->input('details', ''));
        $details = $details !== '' ? $details : null;

        $existingHoliday = AttendanceHoliday::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereDate('holiday_date', $holidayDate)
            ->where('country', $country)
            ->first();

        $wasCreated = false;
        if ($existingHoliday) {
            $existingHoliday->update([
                'title' => trim((string) $request->title),
                'details' => $details,
                'updated_by' => $currentUser->id,
            ]);
            $holiday = $existingHoliday->fresh();
        } else {
            $holiday = AttendanceHoliday::query()->create([
                'organization_id' => $currentUser->organization_id,
                'holiday_date' => $holidayDate,
                'country' => $country,
                'title' => trim((string) $request->title),
                'details' => $details,
                'created_by' => $currentUser->id,
                'updated_by' => $currentUser->id,
            ]);
            $wasCreated = true;
        }

        $this->auditLogService->log(
            action: $wasCreated ? 'attendance.holiday_created' : 'attendance.holiday_updated',
            actor: $currentUser,
            target: $holiday,
            metadata: [
                'holiday_date' => $holidayDate,
                'country' => $country,
                'title' => $holiday->title,
            ],
            request: $request
        );

        return response()->json([
            'message' => $wasCreated ? 'Holiday created.' : 'Holiday updated.',
            'data' => $holiday,
        ], $wasCreated ? 201 : 200);
    }

    public function destroy(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!$this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $holiday = AttendanceHoliday::query()
            ->where('organization_id', $currentUser->organization_id)
            ->find($id);
        if (!$holiday) {
            return response()->json(['message' => 'Holiday not found.'], 404);
        }

        $holidaySnapshot = [
            'holiday_date' => Carbon::parse($holiday->holiday_date)->toDateString(),
            'country' => $holiday->country,
            'title' => $holiday->title,
        ];
        $holiday->delete();

        $this->auditLogService->log(
            action: 'attendance.holiday_deleted',
            actor: $currentUser,
            target: $holiday,
            metadata: $holidaySnapshot,
            request: $request
        );

        return response()->json([
            'message' => 'Holiday deleted.',
        ]);
    }

    private function canManage(User $user): bool
    {
        return in_array($user->role, ['admin', 'manager'], true);
    }
}
