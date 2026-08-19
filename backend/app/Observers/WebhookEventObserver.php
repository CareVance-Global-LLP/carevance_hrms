<?php

namespace App\Observers;

use App\Models\EmployeeExit;
use App\Models\Invoice;
use App\Models\LeaveRequest;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Integrations\WebhookDispatcher;
use Illuminate\Database\Eloquent\Model;

/**
 * Turns things that happen here into things a customer's own system hears
 * about.
 *
 * On the model lifecycle rather than at each call site, for the same reason
 * auditing is: an event a developer has to remember to emit is one that
 * silently stops being emitted. Registered on exactly the five models that
 * carry the eight events, so nothing else pays for it.
 */
class WebhookEventObserver
{
    public function created(Model $model): void
    {
        match (true) {
            $model instanceof User => $this->send($model, 'employee.created', $this->employeePayload($model)),
            $model instanceof EmployeeExit => $this->send($model, 'employee.exited', [
                'employee_id' => $model->user_id,
                'exit_id' => $model->id,
                'last_working_date' => $model->last_working_date?->toDateString(),
            ]),
            default => null,
        };
    }

    public function updated(Model $model): void
    {
        if ($model instanceof User) {
            $this->send($model, 'employee.updated', $this->employeePayload($model));

            return;
        }

        // Everything else is a status transition, and only the transition is
        // interesting — re-sending on every unrelated save would make the
        // stream unusable.
        if (! $model->wasChanged('status')) {
            return;
        }

        $status = (string) $model->getAttribute('status');

        if ($model instanceof PayrollMonthlyRun) {
            $event = match ($status) {
                'approved' => 'payroll.run.approved',
                'disbursed' => 'payroll.run.disbursed',
                default => null,
            };

            if ($event) {
                $this->send($model, $event, [
                    'run_id' => $model->id,
                    'month_year' => $model->month_year,
                    'status' => $status,
                ]);
            }

            return;
        }

        if ($model instanceof LeaveRequest && $status === 'approved') {
            $this->send($model, 'leave.approved', [
                'leave_request_id' => $model->id,
                'employee_id' => $model->user_id,
                'status' => $status,
            ]);

            return;
        }

        if ($model instanceof Invoice && $status === 'paid') {
            $this->send($model, 'invoice.paid', [
                'invoice_id' => $model->id,
                'status' => $status,
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function employeePayload(User $user): array
    {
        // Deliberately narrow. A webhook payload leaves our control the moment
        // it is sent, so it carries identifiers and the few fields an
        // integration actually needs — never salary, PAN or bank details.
        return [
            'employee_id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function send(Model $model, string $event, array $payload): void
    {
        $organizationId = $model->getAttribute('organization_id');

        if ($organizationId === null) {
            return;
        }

        app(WebhookDispatcher::class)->dispatch((int) $organizationId, $event, $payload);
    }
}
