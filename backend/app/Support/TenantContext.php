<?php

namespace App\Support;

/**
 * The tenant a request belongs to when there is no authenticated user.
 *
 * An API key belongs to an organisation but not to a person, so Auth::user()
 * is null for the whole request. BelongsToOrganization treats "no user" as
 * console-or-job and becomes a no-op — correct for a queued job, catastrophic
 * for an inbound HTTP request, where it would mean querying across every
 * tenant. This is where such a request records which tenant it is.
 *
 * A separate class rather than a static on the trait, and that distinction is
 * load-bearing: a static property declared inside a trait gives every class
 * using the trait its OWN copy. Pinning through the trait would have set the
 * tenant for one model out of the ninety-seven that use it, and left the rest
 * unscoped — the exact failure it exists to prevent, made harder to see.
 */
class TenantContext
{
    private static ?int $organizationId = null;

    public static function pin(?int $organizationId): void
    {
        self::$organizationId = $organizationId;
    }

    public static function clear(): void
    {
        self::$organizationId = null;
    }

    public static function current(): ?int
    {
        return self::$organizationId;
    }
}
