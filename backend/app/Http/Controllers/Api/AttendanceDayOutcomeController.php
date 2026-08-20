<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Attendance\DayOutcomeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The penalisation and overtime engines, on a screen.
 *
 * Thin on purpose: the month walk, the tenancy pin and every decision about
 * what a day WAS versus what it COST live in DayOutcomeService.
 *
 * No `role:` middleware. Reading the working behind your own attendance
 * penalty is not a management action — an employee who cannot see which rule
 * fired has no way to question the deduction — so the gate is inside the
 * service, which admits you to your own month and to anybody else's only if you
 * manage and they are in your organization.
 */
class AttendanceDayOutcomeController extends Controller
{
    public function __construct(
        private readonly DayOutcomeService $dayOutcomes,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'month' => ['nullable', 'string', 'regex:/^\d{4}-\d{2}$/'],
            'user_id' => ['nullable', 'integer'],
        ]);

        $result = $this->dayOutcomes->forMonth(
            $request->user(),
            $request->integer('user_id') ?: null,
            $request->query('month') ? (string) $request->query('month') : null,
        );

        return response()->json($result['payload'], $result['status']);
    }
}
