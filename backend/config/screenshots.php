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
         * THE list of selectable intervals. Every validation rule reads it
         * from here — see MonitoringSettingsResolver::allowedIntervals().
         * Three frontend dropdowns still restate it as a literal
         * (EmployeeManagementWorkspace.tsx, add-user/AddUserDrawer.tsx,
         * settings/panes/OrganizationPane.tsx), so widening this list does not
         * offer the new value anywhere until those are updated too, and
         * narrowing it turns an option those screens still show into a 422 on
         * save. The 422 is the tolerable failure: before validation derived
         * from this list, a value the UI offered but this list omitted was
         * accepted, stored, displayed back, and then silently discarded at
         * read time, so capture ran at the inherited interval while every
         * screen insisted otherwise. That is exactly what happened while 1 and
         * 3 were absent here but still offered by three admin UIs.
         *
         * 1- and 3-minute capture is enabled at the product owner's explicit
         * direction (13 Aug 2026), reversing an earlier withdrawal.
         *
         * The reasoning for that withdrawal still stands and is recorded here
         * because re-enabling does not answer it: per-minute screenshots read
         * as continuous screen recording rather than periodic sampling, which
         * needs a far stronger justification than "productivity" under both
         * GDPR and the DPDP Act, and it is a 10x storage multiplier for very
         * little extra signal. The defensible band across the industry is
         * 5-15 minutes. An organization running at 1 minute should have a
         * documented basis for it, and `screenshots.retention.default_days`
         * becomes the thing carrying the storage cost.
         */
        'allowed_minutes' => [1, 3, 5, 10, 15, 30],
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
