<?php

namespace App\Services\Ai;

use RuntimeException;

/**
 * The question cannot be answered from the semantic layer. This is a normal
 * outcome, not a fault: a refusal that names what was missing is recoverable,
 * and the alternative is a number nobody can trust.
 *
 * WHY THIS CARRIES A REASON
 *
 * AI mode now falls back to the prose assistant when the data path refuses, so
 * that "how do I run payroll?" is answered rather than rejected. That fallback
 * must not be universal. Two of these refusals mean opposite things:
 *
 *   NOT_A_DATA_QUESTION  — nothing in the layer fits because the question was
 *                          never about figures. Prose is the RIGHT answer, and
 *                          refusing it is the narrowness this design was told
 *                          to stop.
 *
 *   WITHHELD             — the data exists and we decline to expose it. PAN,
 *                          UAN, ESI, bank details. Handing that to a general
 *                          assistant to answer in prose is how a policy
 *                          exclusion gets talked around instead of enforced,
 *                          so it stays a refusal at every layer.
 *
 * `MALFORMED` is a third: the model produced a plan this system cannot honour.
 * That is a bug report, not a question about the product, so it also does not
 * become prose — answering it conversationally would hide a real defect behind
 * a chat reply.
 */
class UnsupportedQuestionException extends RuntimeException
{
    /** Nothing in the layer fits; the question was not about data. */
    public const NOT_A_DATA_QUESTION = 'not_a_data_question';

    /** The data exists and is deliberately not exposed. Never becomes prose. */
    public const WITHHELD = 'withheld';

    /** The plan was unusable. A defect, not a conversation. */
    public const MALFORMED = 'malformed';

    public function __construct(
        private readonly string $detail,
        private readonly string $reason = self::NOT_A_DATA_QUESTION,
    ) {
        parent::__construct($detail);
    }

    public function getDetail(): string
    {
        return $this->detail;
    }

    public function getReason(): string
    {
        return $this->reason;
    }

    /**
     * Whether the prose assistant may take this question instead.
     *
     * Defaults to yes, because the overwhelming majority of refusals are
     * "that isn't a data question" and that is exactly the case prose exists
     * for. The two that say no have to say so explicitly, which is the right
     * way round: a new refusal added later is conversational by default and
     * cannot silently become a way around an exclusion.
     */
    public function mayAnswerInProse(): bool
    {
        return $this->reason === self::NOT_A_DATA_QUESTION;
    }

    /** The data exists; we decline to expose it. */
    public static function withheld(string $detail): self
    {
        return new self($detail, self::WITHHELD);
    }

    /** The model's plan could not be honoured. */
    public static function malformed(string $detail): self
    {
        return new self($detail, self::MALFORMED);
    }
}
