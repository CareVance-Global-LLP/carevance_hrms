<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Date-only columns must cast as 'date:Y-m-d', never a bare 'date'.
 *
 * A plain 'date' cast serializes as a full UTC datetime, so a calendar date
 * reaches a client in any timezone ahead of UTC a day early. It also makes
 * Eloquent write '2026-06-30 00:00:00', which sorts *after* the bare '2026-06-30'
 * bound used in whereBetween — that silently dropped the last day of every
 * month from the payroll attendance summary until it was found by testing.
 *
 * This has bitten joining dates, checklist due dates and settlement dates
 * before. The convention is cheap to hold and expensive to rediscover, so it
 * is enforced here rather than left to review.
 */
class DateCastConventionTest extends TestCase
{
    public function test_no_model_uses_a_bare_date_cast(): void
    {
        $modelDir = dirname(__DIR__, 2).'/app/Models';
        $offenders = [];

        foreach (glob($modelDir.'/*.php') as $file) {
            $contents = file_get_contents($file);

            // Matches "=> 'date'," but not "=> 'date:Y-m-d'," or "=> 'datetime',".
            if (preg_match_all("/=>\s*'date'\s*,/", $contents, $matches)) {
                $offenders[basename($file)] = count($matches[0]);
            }
        }

        $this->assertSame(
            [],
            $offenders,
            "These models cast a date-only column as a bare 'date', which serializes as a UTC datetime:\n  ".
            implode("\n  ", array_map(
                fn ($file, $count) => "{$file} ({$count} attribute(s))",
                array_keys($offenders),
                $offenders
            )).
            "\n\nUse 'date:Y-m-d'. If the column really carries a time, use 'datetime'."
        );
    }
}
