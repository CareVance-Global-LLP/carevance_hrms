<?php

namespace App\Services\Ai\Actions;

use App\Services\Ai\UnsupportedQuestionException;

/**
 * A change was asked for and will not be made.
 *
 * §6: "A refusal is never a fallback to prose. A person asking for a change and
 * receiving a paragraph would reasonably believe something happened." That is
 * the one behaviour this type exists to guarantee, and it guarantees it
 * STRUCTURALLY rather than by everybody remembering: it extends
 * `UnsupportedQuestionException` with a reason of its own, so
 * `mayAnswerInProse()` is false for every instance and a caller that already
 * catches the read path's refusal cannot accidentally route one of these to the
 * assistant.
 *
 * Extending rather than replacing matters the other way round too. Anything
 * catching `UnsupportedQuestionException` today keeps catching these, so a
 * refusal from the write path can never escape as a 500.
 *
 * EVERY REFUSAL NAMES SOMETHING. The reason codes below are for the client to
 * switch on; the sentence is for the human, and it always contains the thing
 * that was wrong — the action key, the field, the permission, the name that
 * matched nothing. "Forbidden" and "invalid plan" are dead ends: the reader
 * cannot tell whether to rephrase, to ask somebody else, or to give up.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §6
 */
class ActionRefusedException extends UnsupportedQuestionException
{
    /**
     * Not one of `UnsupportedQuestionException`'s three, on purpose.
     *
     * `mayAnswerInProse()` is `$reason === NOT_A_DATA_QUESTION`, so any other
     * value refuses prose. Reusing MALFORMED would have worked and would have
     * said something untrue: "you lack this permission" is not a defect report.
     */
    public const REASON = 'action_refused';

    /** No such key in the catalogue. §6.1. */
    public const UNKNOWN_ACTION = 'unknown_action';

    /** The acting user may not do this. §6.2. */
    public const NOT_PERMITTED = 'not_permitted';

    /** Nothing matched the target — including because it belongs elsewhere. */
    public const NOT_FOUND = 'not_found';

    /** More than one row matched. Picking one is a coin toss with records. */
    public const AMBIGUOUS = 'ambiguous';

    /** A value outside the field's declared bounds. */
    public const OUT_OF_BOUNDS = 'out_of_bounds';

    /** The plan itself could not be read as an action. */
    public const MALFORMED_PLAN = 'malformed_plan';

    /** The row moved between preview and Apply. §4's re-read rule. */
    public const STALE = 'stale';

    /**
     * There is no preview behind this Apply.
     *
     * ONE refusal for every way a token can fail — tampered, expired, issued to
     * somebody else, or unreadable. `ActionToken::open()` deliberately returns a
     * single null for all four, and splitting them apart here would put the
     * oracle back: a caller probing tokens would learn which part of one they
     * had got right. The person's next step is the same in every case, which is
     * why one sentence serves them all: ask again and look at a fresh preview.
     */
    public const NO_PREVIEW = 'no_preview';

    /**
     * The endpoint itself refused the write.
     *
     * Distinct from every refusal above, all of which are decided here before
     * anything is dispatched. This one means the real controller ran its own
     * validation and said no — a duplicate department name, a rule the
     * catalogue does not model — and its words are what get repeated, because
     * they are the only ones that describe the actual objection.
     */
    public const REJECTED = 'rejected';

    public function __construct(string $detail, private readonly string $refusal = self::MALFORMED_PLAN)
    {
        parent::__construct($detail, self::REASON);
    }

    /** Which of the refusals above this is, for a client to switch on. */
    public function refusal(): string
    {
        return $this->refusal;
    }

    public static function unknownAction(string $key): self
    {
        return new self(
            $key === ''
                ? "I can't change that — no action was named."
                : sprintf("I can't change that. There is no action called '%s'.", $key),
            self::UNKNOWN_ACTION,
        );
    }

    public static function notPermitted(string $detail): self
    {
        return new self($detail, self::NOT_PERMITTED);
    }

    public static function notFound(string $detail): self
    {
        return new self($detail, self::NOT_FOUND);
    }

    public static function ambiguous(string $detail): self
    {
        return new self($detail, self::AMBIGUOUS);
    }

    public static function outOfBounds(string $detail): self
    {
        return new self($detail, self::OUT_OF_BOUNDS);
    }

    public static function malformed(string $detail): self
    {
        return new self($detail, self::MALFORMED_PLAN);
    }

    public static function stale(string $detail): self
    {
        return new self($detail, self::STALE);
    }

    public static function noPreview(): self
    {
        return new self(
            "That change is no longer one I can apply — the preview has expired or was not one I offered. Ask again and I'll show you a fresh one.",
            self::NO_PREVIEW,
        );
    }

    public static function rejected(string $detail): self
    {
        return new self($detail, self::REJECTED);
    }
}
