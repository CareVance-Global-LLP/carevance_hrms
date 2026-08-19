<?php

namespace App\Traits;

use App\Support\BlindIndex;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Keeps a blind index in step with an encrypted column.
 *
 * The index is maintained on the model's `saving` event rather than by callers,
 * for the same reason auditing moved onto the model lifecycle: an index a
 * developer has to remember to write is one that silently goes stale, and a
 * stale blind index does not error — it just stops matching, so a PAN lookup
 * quietly returns nothing and a duplicate check quietly finds no duplicates.
 *
 * Models using this must also declare the column as `encrypted` in casts().
 * `AssertsPiiIsEncrypted` in the test suite checks that both halves are
 * present, because either one alone is worse than neither: a cast without an
 * index breaks lookups, and an index without a cast indexes plaintext.
 */
trait EncryptsPii
{
    public static function bootEncryptsPii(): void
    {
        static::saving(function (Model $model) {
            foreach ($model->piiColumns() as $column) {
                // isDirty() is not enough on create, where every attribute is
                // "dirty" but some are simply absent. Checking for the key
                // keeps an untouched column's index alone.
                if (! array_key_exists($column, $model->getAttributes())) {
                    continue;
                }

                $model->setAttribute(
                    $column.'_bidx',
                    BlindIndex::of($model->getAttribute($column))
                );
            }
        });
    }

    /**
     * Columns on this model that hold encrypted PII.
     *
     * @return array<int, string>
     */
    abstract public function piiColumns(): array;

    /**
     * Find rows whose encrypted column equals a value.
     *
     * The replacement for `where('pan_number', $pan)`, which stops matching the
     * moment the column is encrypted — Laravel's encryption is randomised, so
     * the same PAN produces different ciphertext on every write.
     */
    public function scopeWherePii(Builder $query, string $column, ?string $value): Builder
    {
        $index = BlindIndex::of($value);

        if ($index === null) {
            // Asking for "the rows whose PAN is empty" is a different question
            // from "the rows equal to nothing", and answering it as the latter
            // would return every row with a null index — including rows that
            // simply have no PAN. Return nothing instead.
            return $query->whereRaw('1 = 0');
        }

        return $query->where($this->qualifyColumn($column.'_bidx'), $index);
    }
}
