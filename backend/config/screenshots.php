<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Screenshot Signed URL TTL
    |--------------------------------------------------------------------------
    |
    | Number of minutes that generated screenshot file URLs remain valid.
    | Keep this long enough for normal dashboard usage, but still short-lived.
    |
    */
    'url_ttl_minutes' => (int) env('SCREENSHOT_URL_TTL_MINUTES', 30),

    /*
    |--------------------------------------------------------------------------
    | Monitoring Capture Interval
    |--------------------------------------------------------------------------
    |
    | The system-wide fallback capture interval, and the values an admin may
    | choose from. This is the bottom of the resolution chain used by
    | MonitoringSettingsResolver: per-user override -> organization default ->
    | this value. It exists so the default lives in exactly one place; it
    | previously disagreed across seven files.
    |
    */
    'monitoring_interval' => [
        'default_minutes' => (int) env('MONITORING_INTERVAL_DEFAULT_MINUTES', 10),
        'allowed_minutes' => [1, 3, 5, 10, 15, 30],
    ],
];
