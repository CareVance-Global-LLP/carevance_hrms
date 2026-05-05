<?php

namespace App\Services\Payroll;

use App\Models\PayRun;
use App\Models\PayRunApproval;
use App\Models\User;

class PayRunApprovalService
{
    public const STAGES = ['validation', 'manager_approval', 'finance_approval', 'final_approval', 'payout_release'];

    public function defaultWorkflow(): array
    {
        return [
            'stages' => self::STAGES,
            'roles' => [
                'validation' => ['manager', 'admin'],
                'manager_approval' => ['manager', 'admin'],
                'finance_approval' => ['admin'],
                'final_approval' => ['admin'],
                'payout_release' => ['admin'],
            ],
        ];
    }

    public function mappedStatus(string $status): string
    {
        return match ($status) {
            'approved' => 'manager_approved',
            'finalized', 'locked' => 'finance_approved',
            default => $status,
        };
    }

    public function timeline(PayRun $run): array
    {
        return $run->approvals()
            ->with('actor:id,name,email')
            ->orderBy('id')
            ->get()
            ->map(fn (PayRunApproval $approval) => [
                'id' => $approval->id,
                'stage' => $approval->stage,
                'status' => $approval->status,
                'comment' => $approval->comment,
                'rejection_reason' => $approval->rejection_reason,
                'action_at' => optional($approval->action_at)->toIso8601String(),
                'actor' => $approval->actor?->only(['id', 'name', 'email']),
                'meta' => $approval->meta,
            ])
            ->values()
            ->all();
    }

    public function syncDefaults(PayRun $run, array $workflow): void
    {
        foreach (($workflow['stages'] ?? self::STAGES) as $stage) {
            PayRunApproval::query()->firstOrCreate(
                [
                    'organization_id' => $run->organization_id,
                    'pay_run_id' => $run->id,
                    'stage' => $stage,
                ],
                [
                    'status' => 'pending',
                ]
            );
        }
    }

    public function canApprove(User $actor, string $stage, array $workflow): bool
    {
        $roles = data_get($workflow, "roles.{$stage}", []);
        return empty($roles) || in_array($actor->role, $roles, true);
    }

    public function transition(PayRun $run, User $actor, string $nextStatus, ?string $comment = null, ?string $rejectionReason = null): PayRun
    {
        $normalized = $this->mappedStatus($nextStatus);
        $workflow = array_replace_recursive($this->defaultWorkflow(), $run->approval_config ?: []);
        $this->syncDefaults($run, $workflow);

        $stage = match ($normalized) {
            'validated' => 'validation',
            'manager_approved' => 'manager_approval',
            'finance_approved' => 'finance_approval',
            'processed' => 'final_approval',
            'paid' => 'payout_release',
            default => null,
        };

        if ($stage && !$this->canApprove($actor, $stage, $workflow)) {
            abort(403, 'You are not allowed to approve this payroll stage.');
        }

        if ($stage) {
            PayRunApproval::query()
                ->where('organization_id', $run->organization_id)
                ->where('pay_run_id', $run->id)
                ->where('stage', $stage)
                ->update([
                    'status' => $rejectionReason ? 'rejected' : 'approved',
                    'action_by' => $actor->id,
                    'action_at' => now(),
                    'comment' => $comment,
                    'rejection_reason' => $rejectionReason,
                    'meta' => ['run_status' => $normalized],
                ]);
        }

        $run->status = $normalized;
        $run->approval_config = $workflow;
        $run->approval_summary = [
            'timeline' => $this->timeline($run->fresh()),
        ];

        if ($normalized === 'validated') {
            $run->validated_by = $actor->id;
            $run->validated_at = now();
        }
        if ($normalized === 'manager_approved') {
            $run->approved_by = $actor->id;
            $run->approved_at = now();
            $run->manager_approved_by = $actor->id;
            $run->manager_approved_at = now();
        }
        if ($normalized === 'finance_approved') {
            $run->finance_approved_by = $actor->id;
            $run->finance_approved_at = now();
        }
        if ($normalized === 'processed') {
            $run->processed_by = $actor->id;
            $run->processed_at = now();
        }
        if ($normalized === 'paid') {
            $run->paid_by = $actor->id;
            $run->paid_at = now();
        }

        $run->save();

        return $run->fresh(['approvals.actor', 'items.user', 'items.payroll.transactions']);
    }
}
