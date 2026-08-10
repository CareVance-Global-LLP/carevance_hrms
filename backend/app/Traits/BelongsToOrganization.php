<?php

namespace App\Traits;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;

/**
 * Structural multi-tenant isolation.
 *
 * Applying this trait to a model does two things:
 *
 *  1. Every query is automatically constrained to the acting user's
 *     organization. A forgotten `where('organization_id', ...)` in a
 *     controller is no longer a cross-tenant data leak.
 *  2. Every create() automatically stamps organization_id, so rows can
 *     never be written into the wrong tenant by omission.
 *
 * Escape hatches, both explicit and greppable:
 *   Model::withoutOrganizationScope()      — cross-tenant reads (super admin,
 *                                            reporting, console commands)
 *   Model::forOrganization($id)            — pin to a specific tenant
 *
 * The scope is a no-op when there is no authenticated user (console commands,
 * queued jobs, migrations) so background work is not silently filtered to
 * nothing. Jobs that run per-tenant must therefore pin with forOrganization().
 */
trait BelongsToOrganization
{
    public static function bootBelongsToOrganization(): void
    {
        static::addGlobalScope('organization', function (Builder $builder) {
            $organizationId = self::currentOrganizationId();

            if ($organizationId !== null) {
                $builder->where(
                    $builder->getModel()->qualifyColumn('organization_id'),
                    $organizationId
                );

                return;
            }

            // A null organization means one of two very different things, and
            // treating them the same was a cross-tenant hole.
            //
            //   No authenticated user  → console command, queued job, migration.
            //                            The scope must be a no-op or background
            //                            work silently filters to nothing.
            //
            //   Authenticated, no org  → a user row with organization_id NULL.
            //                            Previously this ALSO skipped the filter,
            //                            so such an account read every tenant's
            //                            data through every scoped model.
            //
            // Fail closed on the second: an org-less session sees nothing rather
            // than everything. Anything that legitimately needs cross-tenant
            // reads already has withoutOrganizationScope().
            if (Auth::hasUser()) {
                $builder->whereRaw('1 = 0');
            }
        });

        static::creating(function (Model $model) {
            if (empty($model->getAttribute('organization_id'))) {
                $organizationId = self::currentOrganizationId();

                if ($organizationId !== null) {
                    $model->setAttribute('organization_id', $organizationId);
                }
            }
        });
    }

    /**
     * The organization of the acting user, or null when unauthenticated.
     *
     * Super admins are deliberately NOT exempted here. Making the scope
     * silently disappear for one role is how cross-tenant leaks get shipped;
     * super-admin code paths must opt out explicitly via
     * withoutOrganizationScope() so the intent is visible at the call site.
     */
    protected static function currentOrganizationId(): ?int
    {
        if (!Auth::hasUser()) {
            return null;
        }

        $organizationId = Auth::user()?->organization_id;

        return $organizationId !== null ? (int) $organizationId : null;
    }

    /**
     * Drop the tenant constraint. Use only where cross-tenant access is
     * genuinely intended, and prefer forOrganization() when the target
     * tenant is known.
     */
    public static function withoutOrganizationScope(): Builder
    {
        return static::query()->withoutGlobalScope('organization');
    }

    /**
     * Pin the query to an explicit organization, bypassing the ambient one.
     */
    public static function forOrganization(int $organizationId): Builder
    {
        return static::withoutOrganizationScope()
            ->where((new static())->qualifyColumn('organization_id'), $organizationId);
    }
}
