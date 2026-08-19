<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Monitoring\MonitoringConsentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The employee-facing half of monitoring consent, and the admin half that
 * publishes what they are consenting to.
 */
class MonitoringConsentController extends Controller
{
    public function __construct(private readonly MonitoringConsentService $consent)
    {
    }

    /**
     * What is collected about me, why, for how long, and what I have agreed to.
     *
     * Deliberately available to every employee about themselves. A disclosure
     * an employee cannot read is not a disclosure.
     */
    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $this->consent->disclosureFor($request->user()),
        ]);
    }

    public function grant(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'capture_types' => ['present', 'array'],
            'capture_types.*' => ['string', 'in:'.implode(',', MonitoringConsentService::CAPTURE_TYPES)],
        ]);

        try {
            $this->consent->grant($request->user(), $validated['capture_types'], $request);
        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
                'error_code' => 'NO_MONITORING_NOTICE',
            ], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'Your choices have been recorded.',
            'data' => $this->consent->disclosureFor($request->user()->fresh()),
        ]);
    }

    /**
     * Withdraw consent.
     *
     * Always available, and never argued with. A withdrawal that has to be
     * negotiated is not a right.
     */
    public function withdraw(Request $request): JsonResponse
    {
        $this->consent->withdraw($request->user());

        return response()->json([
            'success' => true,
            'message' => 'Consent withdrawn. Collection of this data will stop.',
            'data' => $this->consent->disclosureFor($request->user()->fresh()),
        ]);
    }

    /**
     * Publish a new version of the notice.
     *
     * Publishing supersedes rather than edits: consent already given is
     * recorded against the version it was given to, so new wording asks again
     * instead of inheriting an answer to different words.
     */
    public function publishNotice(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'body' => ['required', 'string', 'min:40', 'max:20000'],
            'purposes' => ['required', 'array'],
            'purposes.*' => ['required', 'string', 'min:10', 'max:1000'],
            'retention_days' => ['required', 'integer', 'min:1', 'max:3650'],
            // Required, not optional. The DPDP Rules oblige a consent notice
            // to say who a complaint goes to; a notice without one discloses
            // but offers no way to object.
            'grievance_contact_name' => ['required', 'string', 'max:160'],
            'grievance_contact_email' => ['required', 'email', 'max:255'],
        ]);

        $notice = $this->consent->publishNotice(
            $request->user()->organization,
            $validated['body'],
            $validated['purposes'],
            $validated['retention_days'],
            $request->user(),
            $validated['grievance_contact_name'],
            $validated['grievance_contact_email'],
        );

        return response()->json([
            'success' => true,
            'message' => "Notice version {$notice->version} published. Employees will be asked to agree to it.",
            'data' => [
                'version' => $notice->version,
                'published_at' => $notice->published_at?->toIso8601String(),
            ],
        ], 201);
    }
}
