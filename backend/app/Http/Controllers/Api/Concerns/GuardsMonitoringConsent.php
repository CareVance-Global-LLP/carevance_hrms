<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Models\User;
use App\Services\Monitoring\MonitoringConsentService;
use Illuminate\Http\JsonResponse;

/**
 * One refusal, shared by every capture path.
 *
 * Screenshots, activity, geofenced punches and attendance selfies arrive
 * through four different controllers. Four hand-written checks would be four
 * chances to word the refusal differently, return a different status, or
 * forget one entirely — and the one forgotten is the one that keeps collecting
 * without consent.
 */
trait GuardsMonitoringConsent
{
    /**
     * Returns a refusal response, or null when the capture may proceed.
     *
     * 403 with a machine-readable code rather than a silent drop: the desktop
     * tracker needs to know the difference between "the server did not want
     * this" and "the network ate it", or it will retry a refused capture
     * forever.
     */
    protected function refuseIfCaptureNotConsented(?User $user, string $captureType): ?JsonResponse
    {
        $reason = app(MonitoringConsentService::class)->refusalReason($user, $captureType);

        if ($reason === null) {
            return null;
        }

        return response()->json([
            'success' => false,
            'message' => $reason,
            'error_code' => 'MONITORING_CONSENT_REQUIRED',
            'capture_type' => $captureType,
        ], 403);
    }
}
