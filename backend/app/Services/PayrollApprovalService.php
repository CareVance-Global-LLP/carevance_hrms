<?php

namespace App\Services;

use App\Models\PayrollApprovalWorkflow;
use App\Models\PayrollApprovalStep;
use App\Models\PayrollApprovalAction;
use App\Models\PayrollRun;
use Illuminate\Support\Facades\DB;

/**
 * Multi-Level Payroll Approval Workflow Service
 *
 * Supports N-level approval chains (Manager → HRBP → Finance → CFO).
 * Each step can have its own approver list (any approver can act) or
 * require unanimous consent.
 *
 * Tracks the complete audit trail of approvals/rejections.
 */
class PayrollApprovalService
{
    /**
     * Create a new approval workflow for a payroll run.
     */
    public function createWorkflow(PayrollRun $run, array $steps): PayrollApprovalWorkflow
    {
        return DB::transaction(function () use ($run, $steps) {
            $workflow = PayrollApprovalWorkflow::create([
                'payroll_run_id' => $run->id,
                'organization_id' => $run->organization_id,
                'status' => 'pending',
                'current_step' => 1,
                'total_steps' => count($steps),
            ]);
            foreach ($steps as $i => $step) {
                PayrollApprovalStep::create([
                    'workflow_id' => $workflow->id,
                    'step_number' => $i + 1,
                    'name' => $step['name'] ?? "Level " . ($i + 1),
                    'approver_ids' => $step['approver_ids'] ?? [],
                    'approval_type' => $step['type'] ?? 'any', // 'any' or 'all'
                    'min_amount' => $step['min_amount'] ?? 0,
                    'max_amount' => $step['max_amount'] ?? null,
                ]);
            }
            return $workflow;
        });
    }

    /**
     * Submit an approval (approve/reject) for a step.
     */
    public function act(int $workflowId, int $userId, string $action, ?string $comment = null): array
    {
        $workflow = PayrollApprovalWorkflow::with('steps')->findOrFail($workflowId);
        $currentStep = $workflow->steps->where('step_number', $workflow->current_step)->first();
        if (!$currentStep) return ['status' => 'no_active_step'];

        if (!in_array($userId, $currentStep->approver_ids ?? [])) {
            return ['status' => 'not_authorized', 'message' => 'You are not an approver for this step'];
        }

        DB::transaction(function () use ($workflow, $currentStep, $userId, $action, $comment) {
            PayrollApprovalAction::create([
                'workflow_id' => $workflow->id,
                'step_id' => $currentStep->id,
                'actor_id' => $userId,
                'action' => $action, // 'approved' or 'rejected'
                'comment' => $comment,
            ]);

            if ($action === 'rejected') {
                $workflow->update(['status' => 'rejected']);
                return;
            }

            // Check if step is satisfied
            $actions = $currentStep->actions()->where('action', 'approved')->count();
            $required = $currentStep->approval_type === 'all' ? count($currentStep->approver_ids) : 1;
            if ($actions >= $required) {
                $currentStep->update(['status' => 'approved']);
                $next = $workflow->current_step + 1;
                if ($next > $workflow->total_steps) {
                    $workflow->update(['status' => 'approved', 'current_step' => $workflow->total_steps]);
                } else {
                    $workflow->update(['current_step' => $next]);
                }
            }
        });
        return ['status' => $action, 'workflow' => $workflow->fresh('steps')];
    }

    public function status(int $workflowId): array
    {
        $workflow = PayrollApprovalWorkflow::with(['steps.actions.actor'])->findOrFail($workflowId);
        return [
            'status' => $workflow->status,
            'current_step' => $workflow->current_step,
            'steps' => $workflow->steps->map(fn($s) => [
                'step_number' => $s->step_number,
                'name' => $s->name,
                'status' => $s->status,
                'approver_count' => count($s->approver_ids ?? []),
                'actions' => $s->actions->map(fn($a) => [
                    'actor' => $a->actor?->name,
                    'action' => $a->action,
                    'comment' => $a->comment,
                    'at' => $a->created_at,
                ])->toArray(),
            ])->toArray(),
        ];
    }
}
