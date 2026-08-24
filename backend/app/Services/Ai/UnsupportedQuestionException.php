<?php

namespace App\Services\Ai;

use RuntimeException;

/**
 * The question cannot be answered from the semantic layer. This is a normal
 * outcome, not a fault: a refusal that names what was missing is recoverable,
 * and the alternative is a number nobody can trust.
 */
class UnsupportedQuestionException extends RuntimeException
{
    public function __construct(private readonly string $detail)
    {
        parent::__construct($detail);
    }

    public function getDetail(): string
    {
        return $this->detail;
    }
}
