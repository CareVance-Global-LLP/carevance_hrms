<?php

namespace App\Services\Payroll;

/**
 * The one sanctioned way to write money onto a closed payroll run.
 *
 * PayrollItemObserver refuses those writes outright. That is correct as a
 * default and wrong as an absolute: a governed correction -- an approved
 * override, a court-ordered recovery, the versioned supersede in D4 -- does
 * legitimately need to touch a closed run, and it needs to do so visibly.
 *
 * Binding this context is that visibility. A caller states a reason, the write
 * proceeds inside the closure, and the permission is unwound afterwards even if
 * the work throws. Because the only way to obtain it is to name a reason, a
 * grep for permit() lists every sanctioned path -- which an in_array() guard
 * scattered across nine controllers never could.
 *
 * Registered as a singleton so the flag is visible to the observer resolved
 * from the same container.
 */
class ClosedRunWriteContext
{
    private bool $permitted = false;

    private ?string $reason = null;

    /**
     * Run $work with closed-run writes permitted, then restore the previous
     * state.
     *
     * Nested calls are safe: the previous reason is restored rather than
     * cleared, so an inner permit() cannot silently revoke an outer one.
     *
     * @template T
     * @param  callable():T  $work
     * @return T
     */
    public function permit(string $reason, callable $work): mixed
    {
        $previousPermitted = $this->permitted;
        $previousReason = $this->reason;

        $this->permitted = true;
        $this->reason = $reason;

        try {
            return $work();
        } finally {
            $this->permitted = $previousPermitted;
            $this->reason = $previousReason;
        }
    }

    public function isPermitted(): bool
    {
        return $this->permitted;
    }

    /**
     * Why the current write is permitted, for audit records and exceptions.
     */
    public function reason(): ?string
    {
        return $this->reason;
    }
}
