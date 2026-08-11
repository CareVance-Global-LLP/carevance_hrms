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
        /*
         * 1- and 3-minute capture is deliberately gone.
         *
         * Per-minute screenshots read as continuous screen recording rather
         * than periodic sampling, which needs a far stronger justification
         * than "productivity" under both GDPR and the DPDP Act — and it is a
         * 10x storage multiplier for very little extra signal. The defensible
         * band across the industry is 5-15 minutes.
         *
         * Organizations already set to 1 or 3 are not rejected; they are
         * rounded up to the nearest allowed value (see
         * MonitoringSettingsResolver::sanitize).
         */
        'allowed_minutes' => [5, 10, 15, 30],
    ],

    /*
    |--------------------------------------------------------------------------
    | Retention
    |--------------------------------------------------------------------------
    |
    | How long a screenshot survives before `screenshots:purge` removes both
    | the row and the stored file. Nothing deleted screenshots before this
    | existed, so storage grew without limit and "kept only as long as it
    | serves the stated purpose" had no mechanism behind it.
    |
    */
    'retention' => [
        'default_days' => (int) env('SCREENSHOT_RETENTION_DAYS', 90),
    ],

    /*
    |--------------------------------------------------------------------------
    | Capture-Time Privacy
    |--------------------------------------------------------------------------
    |
    | Foreground applications whose screens are never captured. Matched as a
    | case-insensitive substring against the active window's application name
    | and title, so "1password" also covers "1Password 8".
    |
    */
    'privacy' => [
        'blocked_apps' => [
            '1password',
            'bitwarden',
            'lastpass',
            'keepass',
            'dashlane',
            'keychain access',
            'windows security',
        ],
        'skip_on_private_browsing' => (bool) env('SCREENSHOT_SKIP_PRIVATE_BROWSING', true),
    ],
];
