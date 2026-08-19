<?php

namespace App\Traits;

use App\Observers\AuditObserver;

/**
 * Records every create, update and delete of this model to `audit_logs`.
 *
 * This exists because the previous design did not. Auditing was a line a
 * developer had to remember to write in a controller, and 72 of 80 controllers
 * did not write it — payroll runs, bank disbursement, statutory filings, role
 * changes, exits and performance reviews all mutated with no actor trail at
 * all. An external auditor asking "who approved this run" had no answer.
 *
 * Placing it on the model's lifecycle rather than at the call site means the
 * trail cannot be skipped by writing new code that forgets about it. The only
 * ways past it are `saveQuietly()` and mass query-builder updates, both of
 * which are already visible and deliberate in review.
 *
 * `AuditCoverageTest` fails if a model on the money-or-identity list does not
 * use this trait, so the list and the code cannot drift apart.
 */
trait Auditable
{
    public static function bootAuditable(): void
    {
        static::observe(AuditObserver::class);
    }

    /**
     * Attributes never written to the audit trail for this model.
     *
     * Override in the model to extend. Secrets are additionally stripped by
     * AuditLogService, which owns the global sensitive-key list — this is for
     * per-model noise, not for security.
     *
     * @return array<int, string>
     */
    public function auditExcluded(): array
    {
        return ['updated_at', 'created_at', 'remember_token'];
    }

    /**
     * The audit action prefix for this model, e.g. "payroll_run".
     *
     * Defaults to the snake_cased class basename, which is what every current
     * caller wants.
     */
    public function auditName(): string
    {
        return \Illuminate\Support\Str::snake(class_basename($this));
    }
}
