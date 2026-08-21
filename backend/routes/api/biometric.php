<?php

use App\Http\Controllers\Api\BiometricPushController;
use Illuminate\Support\Facades\Route;

/**
 * ADMS push endpoints for eSSL / ZKTeco / Biomax / Matrix punch devices.
 *
 * Registered OUTSIDE the api.token group, and that is not an oversight. A wall
 * terminal cannot hold a bearer token, cannot follow a redirect and cannot be
 * enrolled in MFA. The protocol is fixed by the hardware; our choice is whether
 * to speak it or not to support the devices at all.
 *
 * What stands in for authentication:
 *
 *   1. The serial must be registered by an admin first. An unknown serial gets
 *      an empty 200 and nothing is stored — never auto-enrolment, or anyone who
 *      learned this URL could post attendance into a tenant.
 *   2. Punches are unique on (device, device user, timestamp) in the database,
 *      so replaying a captured request is a no-op.
 *   3. A punch is a signal, not a conclusion — it records that a reading
 *      happened and does not by itself decide anybody's pay.
 *
 * The `/iclock` prefix is not ours to choose: it is hardcoded in the firmware.
 *
 * Throttled generously rather than tightly. A site with several devices polling
 * every ten seconds is normal traffic, and a device that gets a 429 does not
 * back off politely — it retries harder, or drops its queue.
 */
Route::prefix('iclock')->middleware('throttle:600,1')->group(function () {
    Route::get('/cdata', [BiometricPushController::class, 'handshake']);
    Route::post('/cdata', [BiometricPushController::class, 'receive']);
    Route::get('/getrequest', [BiometricPushController::class, 'commands']);
    Route::post('/devicecmd', [BiometricPushController::class, 'commandResult']);
});
