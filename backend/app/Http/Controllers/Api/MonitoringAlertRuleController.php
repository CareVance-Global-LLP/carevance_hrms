<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Group;
use App\Models\MonitoringAlertRule;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Manages the rules that decide when a monitoring figure is worth telling
 * somebody about. Admin-only: a rule chooses who gets told what about whom.
 */
class MonitoringAlertRuleController extends Controller
{
    private function denyNonAdmin(Request $request): ?\Illuminate\Http\JsonResponse
    {
        $user = $request->user();

        if (! $user || $user->getHierarchyLevel() > 10) {
            return response()->json(['message' => 'Only admins can manage monitoring alerts.'], 403);
        }

        return null;
    }

    public function index(Request $request)
    {
        if ($denied = $this->denyNonAdmin($request)) {
            return $denied;
        }

        return response()->json([
            'data' => MonitoringAlertRule::with('group:id,name')
                ->orderByDesc('id')
                ->get()
                ->map(fn (MonitoringAlertRule $rule) => $this->present($rule)),
            'metrics' => $this->metricCatalog(),
        ]);
    }

    public function store(Request $request)
    {
        if ($denied = $this->denyNonAdmin($request)) {
            return $denied;
        }

        $validated = $this->validatePayload($request);
        $validated['organization_id'] = $request->user()->organization_id;

        $rule = MonitoringAlertRule::create($validated);

        return response()->json($this->present($rule->fresh('group')), 201);
    }

    public function update(Request $request, MonitoringAlertRule $monitoringAlertRule)
    {
        if ($denied = $this->denyNonAdmin($request)) {
            return $denied;
        }

        // BelongsToOrganization scopes the lookup, so a rule from another tenant
        // is already a 404 by the time this runs.
        $monitoringAlertRule->update($this->validatePayload($request, $monitoringAlertRule));

        return response()->json($this->present($monitoringAlertRule->fresh('group')));
    }

    public function destroy(Request $request, MonitoringAlertRule $monitoringAlertRule)
    {
        if ($denied = $this->denyNonAdmin($request)) {
            return $denied;
        }

        $monitoringAlertRule->delete();

        return response()->json(['message' => 'Alert removed.']);
    }

    /** @return array<string, mixed> */
    private function validatePayload(Request $request, ?MonitoringAlertRule $existing = null): array
    {
        $required = $existing ? 'sometimes|required' : 'required';

        $validated = $request->validate([
            'name' => $required.'|string|max:120',
            'metric' => [$existing ? 'sometimes' : 'required', 'string', Rule::in(MonitoringAlertRule::METRICS)],
            /*
             * Seconds for durations, whole percent for shares. Bounded on both
             * sides: a threshold of zero on "tracked below" would fire for
             * nobody, and one above a full day would fire for everybody — both
             * are rules that look configured and do nothing useful.
             */
            'threshold' => $required.'|integer|min:0|max:86400',
            'group_id' => ['nullable', Rule::exists('groups', 'id')],
            'is_enabled' => 'sometimes|boolean',
        ]);

        if (array_key_exists('group_id', $validated) && $validated['group_id']) {
            $belongsToOrg = Group::query()
                ->whereKey($validated['group_id'])
                ->where('organization_id', $request->user()->organization_id)
                ->exists();

            if (! $belongsToOrg) {
                abort(response()->json(['message' => 'Selected group is not available.'], 422));
            }
        }

        return $validated;
    }

    /** @return array<int, array<string, mixed>> */
    private function metricCatalog(): array
    {
        return [
            [
                'value' => MonitoringAlertRule::METRIC_NO_ACTIVITY,
                'label' => 'Recorded no time at all',
                'unit' => 'none',
                'help' => 'Catches a tracker that stopped working as well as a day nobody worked.',
            ],
            [
                'value' => MonitoringAlertRule::METRIC_TRACKED_BELOW,
                'label' => 'Tracked less than',
                'unit' => 'hours',
                'help' => 'A short day against the hours you expect.',
            ],
            [
                'value' => MonitoringAlertRule::METRIC_IDLE_SHARE_ABOVE,
                'label' => 'Idle more than',
                'unit' => 'percent',
                'help' => 'A day where the timer ran but little happened.',
            ],
        ];
    }

    /** @return array<string, mixed> */
    private function present(MonitoringAlertRule $rule): array
    {
        return [
            'id' => $rule->id,
            'name' => $rule->name,
            'metric' => $rule->metric,
            'threshold' => (int) $rule->threshold,
            'group_id' => $rule->group_id,
            'group_name' => $rule->group?->name,
            'is_enabled' => (bool) $rule->is_enabled,
            'description' => $rule->describe(),
            'last_evaluated_at' => optional($rule->last_evaluated_at)->toIso8601String(),
        ];
    }
}
