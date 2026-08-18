<?php

namespace App\Services\Payroll;

use App\Models\PayrollOverride;
use App\Models\PayrollOverrideAudit;

/**
 * The single writer for the override trail.
 *
 * One place, because the controller and the payroll engine both record against
 * the same override and a trail whose rows disagree about their own shape is
 * not much of a trail. Every method here INSERTS; none updates, and none
 * deletes.
 *
 * The snapshot is deliberately narrow — the fields that decide money and
 * lifetime, not the whole row. A wide dump would carry the timestamps and the
 * status of the moment, which the action already states, and would make two
 * genuinely identical states look different.
 */
class OverrideAuditTrail
{
    public function created(PayrollOverride $override, ?int $actorId): PayrollOverrideAudit
    {
        return $this->record($override, PayrollOverrideAudit::ACTION_CREATED, $actorId, null, $this->snapshot($override));
    }

    /**
     * @param  string|null  $note  Set when the approval needed explaining —
     *                             a sole-admin self-approval says so here
     *                             rather than leaving a reader to infer it
     *                             from created_by and approved_by matching.
     */
    public function approved(PayrollOverride $override, ?int $actorId, array $before, ?string $note = null): PayrollOverrideAudit
    {
        return $this->record($override, PayrollOverrideAudit::ACTION_APPROVED, $actorId, $before, $this->snapshot($override), $note);
    }

    public function rejected(PayrollOverride $override, ?int $actorId, array $before, string $note): PayrollOverrideAudit
    {
        return $this->record($override, PayrollOverrideAudit::ACTION_REJECTED, $actorId, $before, $this->snapshot($override), $note);
    }

    public function cancelled(PayrollOverride $override, ?int $actorId, array $before, ?string $note = null): PayrollOverrideAudit
    {
        return $this->record($override, PayrollOverrideAudit::ACTION_CANCELLED, $actorId, $before, $this->snapshot($override), $note);
    }

    /**
     * The engine's own line: this override moved this month's figures.
     *
     * Idempotent per override per month, because reprocessing an open run is a
     * normal thing to do — a corrected attendance record, a late arrear — and
     * the second pass applies exactly the same override for exactly the same
     * month. Recording it again would turn "applied once, in June" into a
     * counter of how many times payroll happened to be re-run, which reads on
     * the trail as repeated interference.
     *
     * The month lives in after_json rather than in a column of its own: this
     * table is keyed on the override, and the run is a property of the event
     * rather than a second thing being audited.
     *
     * @param  array<string, mixed>  $detail  computed_value and the cascade, as applied.
     */
    public function applied(PayrollOverride $override, string $monthYear, array $detail): ?PayrollOverrideAudit
    {
        $alreadyRecorded = PayrollOverrideAudit::query()
            ->where('payroll_override_id', $override->id)
            ->where('action', PayrollOverrideAudit::ACTION_APPLIED)
            ->get()
            ->contains(fn (PayrollOverrideAudit $audit) => ($audit->after_json['month_year'] ?? null) === $monthYear);

        if ($alreadyRecorded) {
            return null;
        }

        return $this->record(
            $override,
            PayrollOverrideAudit::ACTION_APPLIED,
            // No acting user. A queued run authenticates as whoever started it,
            // but the decision recorded here is the engine's, not theirs.
            null,
            null,
            $detail + ['month_year' => $monthYear],
        );
    }

    /**
     * The fields worth diffing: what is paid, and for how long.
     *
     * @return array<string, mixed>
     */
    public function snapshot(PayrollOverride $override): array
    {
        return [
            'status' => $override->status,
            'scope' => $override->scope,
            'target' => $override->target,
            'mode' => $override->mode,
            'value' => (float) $override->value,
            'balance_mode' => $override->balance_mode,
            'effective_from' => $override->effective_from?->toDateString(),
            'effective_to' => $override->effective_to?->toDateString(),
        ];
    }

    private function record(
        PayrollOverride $override,
        string $action,
        ?int $actorId,
        ?array $before,
        ?array $after,
        ?string $note = null
    ): PayrollOverrideAudit {
        return PayrollOverrideAudit::create([
            'organization_id' => $override->organization_id,
            'payroll_override_id' => $override->id,
            'action' => $action,
            'actor_id' => $actorId,
            'before_json' => $before,
            'after_json' => $after,
            'note' => $note,
            'created_at' => now(),
        ]);
    }
}
