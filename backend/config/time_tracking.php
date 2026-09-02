<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Idle Activity Threshold
    |--------------------------------------------------------------------------
    |
    | Number of continuous idle seconds before tracker events are labeled as
    | idle activity instead of app/url activity.
    |
    */
    'idle_track_threshold_seconds' => (int) env('IDLE_TRACK_THRESHOLD_SECONDS', 180),

    /*
    |--------------------------------------------------------------------------
    | Idle Auto-Stop Threshold
    |--------------------------------------------------------------------------
    |
    | Number of continuous idle seconds required before the backend accepts
    | an automatic timer stop for idle inactivity.
    |
    | Raised from 300 to 900 on 13 Aug 2026. Five minutes stopped a timer
    | during a phone call, a design review or a long read — all of which look
    | identical to a keyboard. The comparable products are far less aggressive:
    | Time Doctor defaults to 15 minutes over a 3-minute-to-6-hour range, and
    | Insightful's automatic clock-out defaults to 4 hours. Nothing is lost by
    | waiting, because the tracker asks the person what the gap was on their
    | return rather than deducting it silently.
    |
    | An organization that wants the old behaviour can now set it directly:
    | Settings -> Organization -> Monitoring -> Idle and inactivity.
    |
    */
    'idle_auto_stop_threshold_seconds' => (int) env('IDLE_AUTO_STOP_THRESHOLD_SECONDS', 900),

    /*
    |--------------------------------------------------------------------------
    | Lock-Screen Auto-Stop Threshold
    |--------------------------------------------------------------------------
    |
    | Seconds a workstation may stay locked before the running timer is stopped.
    |
    | TrackerPolicyResolver has always resolved this key, but it was never
    | defined here — so the resolver's own inline fallback of 300 was the only
    | value it could ever take, and no deployment could change it. Five minutes
    | is shorter than most Windows auto-lock policies, which means a screen that
    | locks itself while somebody reads stops their timer.
    |
    | Defined at the same 300 the fallback used, so nothing changes on upgrade;
    | what changes is that it can now be raised.
    |
    */
    'lock_auto_stop_threshold_seconds' => (int) env('LOCK_AUTO_STOP_THRESHOLD_SECONDS', 300),

    /*
    |--------------------------------------------------------------------------
    | Stale Timer Max Minutes
    |--------------------------------------------------------------------------
    |
    | Maximum minutes a running timer is allowed to exist without any activity
    | before the scheduled cleanup command auto-closes it. This prevents
    | orphaned timers from accumulating when users close the browser or
    | desktop app without stopping the timer.
    |
    */
    'stale_timer_max_minutes' => (int) env('STALE_TIMER_MAX_MINUTES', 120),
];
