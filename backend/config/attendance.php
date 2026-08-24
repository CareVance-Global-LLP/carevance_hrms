<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Shift Configuration
    |--------------------------------------------------------------------------
    |
    | Default shift settings for attendance tracking.
    |
    */
    'shift_seconds' => max(1, (int) env('ATTENDANCE_SHIFT_SECONDS', 8 * 3600)),

    /*
    |--------------------------------------------------------------------------
    | Late Threshold
    |--------------------------------------------------------------------------
    |
    | Time after which an employee is considered late.
    |
    */
    'late_after' => env('ATTENDANCE_LATE_AFTER', '10:30:00'),

    /*
    |--------------------------------------------------------------------------
    | Forgotten check-out cap
    |--------------------------------------------------------------------------
    |
    | How long after punch-in `attendance:close-open-punches` will credit when
    | no shift is known for that person.
    |
    | Sixteen hours is deliberately generous: it has to clear a long shift plus
    | overtime without truncating a real day, because being cut short costs
    | somebody pay. Where a shift IS known the sweeper closes at its end
    | instead, which is both earlier and more honest — this is only the
    | fallback.
    |
    */
    'auto_close_max_hours' => max(1, (int) env('ATTENDANCE_AUTO_CLOSE_MAX_HOURS', 16)),

    /*
    |--------------------------------------------------------------------------
    | Office Start Time
    |--------------------------------------------------------------------------
    |
    | Default office start time.
    |
    */
    'office_start' => env('ATTENDANCE_OFFICE_START', '09:00:00'),
];
