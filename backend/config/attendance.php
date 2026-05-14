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
    | Office Start Time
    |--------------------------------------------------------------------------
    |
    | Default office start time.
    |
    */
    'office_start' => env('ATTENDANCE_OFFICE_START', '09:00:00'),
];
