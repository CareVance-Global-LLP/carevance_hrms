<?php

namespace App\Observers;

use App\Services\Audit\AuditLogService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;

/**
 * Writes the audit trail for any model using the Auditable trait.
 *
 * Deliberately thin: it decides *what* is worth recording and delegates the
 * writing to AuditLogService, which already sanitises secrets, resolves the
 * organisation and fails soft. An audit write must never be the reason a
 * payroll run fails to save.
 */
class AuditObserver
{
    public function created(Model $model): void
    {
        $this->record($model, 'created', [
            'attributes' => $this->filter($model, $model->getAttributes()),
        ]);
    }

    public function updated(Model $model): void
    {
        $changes = $this->filter($model, $model->getChanges());

        // An update that changed nothing auditable — a touch, a timestamp
        // refresh — is noise. Recording it makes the trail harder to read and
        // hides the entries that matter.
        if ($changes === []) {
            return;
        }

        $before = [];
        foreach (array_keys($changes) as $key) {
            $before[$key] = $model->getOriginal($key);
        }

        $this->record($model, 'updated', [
            'changed' => $changes,
            'previous' => $before,
        ]);
    }

    public function deleted(Model $model): void
    {
        $this->record($model, 'deleted', [
            'attributes' => $this->filter($model, $model->getOriginal()),
        ]);
    }

    /**
     * Strip per-model noise. Secrets are removed downstream by
     * AuditLogService, which owns the global sensitive-key list.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function filter(Model $model, array $attributes): array
    {
        $excluded = method_exists($model, 'auditExcluded')
            ? $model->auditExcluded()
            : ['created_at', 'updated_at'];

        return array_diff_key($attributes, array_flip($excluded));
    }

    /**
     * @param  array<string, mixed>  $metadata
     */
    private function record(Model $model, string $verb, array $metadata): void
    {
        $name = method_exists($model, 'auditName')
            ? $model->auditName()
            : \Illuminate\Support\Str::snake(class_basename($model));

        $actor = Auth::user();

        /*
         * Break-glass attribution.
         *
         * When a vendor engineer is acting through an approved break-glass
         * session, the acting user resolves to the *customer's* employee —
         * which is exactly what makes the impersonation useful and exactly
         * what makes an unstamped trail a lie. Recording the session id here
         * means the entry reads "changed under break-glass session 41", not
         * merely "changed by Priya".
         */
        $breakGlassSessionId = request()?->attributes?->get('break_glass_session_id');

        if ($breakGlassSessionId !== null) {
            $metadata['break_glass_session_id'] = $breakGlassSessionId;
        }

        app(AuditLogService::class)->log(
            action: "{$name}.{$verb}",
            actor: $actor,
            target: $model,
            metadata: $metadata,
            request: request(),
            organizationId: $this->resolveOrganizationId($model, $actor),
        );
    }

    private function resolveOrganizationId(Model $model, ?\App\Models\User $actor): ?int
    {
        $own = $model->getAttribute('organization_id');

        if ($own !== null) {
            return (int) $own;
        }

        return $actor?->organization_id;
    }
}
