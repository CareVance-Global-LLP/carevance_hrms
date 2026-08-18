<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * A write to a closed payroll run was refused.
 *
 * Renders itself as a 422 so every refusal reaches the client in the same
 * shape as the hand-written guards it replaces, without a change to the
 * exception handler.
 */
class ClosedPayrollRunException extends RuntimeException
{
    public function __construct(
        public readonly string $monthYear,
        public readonly string $runStatus,
        public readonly string $operation,
    ) {
        parent::__construct(
            "Cannot {$operation} — payroll run {$monthYear} is already {$runStatus} "
            . 'and its figures are immutable. Raise the correction against the next open run instead.'
        );
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => $this->getMessage(),
            'month_year' => $this->monthYear,
            'run_status' => $this->runStatus,
        ], 422);
    }
}
