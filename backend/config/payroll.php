<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Payroll Dev Mode
    |--------------------------------------------------------------------------
    |
    | Bypasses the plan/feature gate on payroll routes so payroll can be worked
    | on without a billing plan attached to the organization.
    |
    | This lives in config rather than being read with env() inside the
    | middleware. Calling env() outside a config file is unsafe: the moment a
    | deploy runs `php artisan config:cache`, the .env file is no longer read at
    | runtime and every such call returns its default. The flag would silently
    | stop working with no error, which is exactly the kind of failure that is
    | impossible to diagnose from a bug report.
    |
    */
    'dev_mode' => (bool) env('PAYROLL_DEV_MODE', false),
];
