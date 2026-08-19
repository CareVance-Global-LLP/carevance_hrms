<?php

use App\Support\BlindIndex;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase one of encrypting employee PII at rest.
 *
 * Account numbers, UPI IDs, PAN, Aadhaar and other government identifiers, UAN
 * and ESI numbers were all stored as ordinary columns. Anyone with a database
 * dump — a backup file, a mis-scoped replica, a compromised ops account — held
 * the complete financial identity of every employee in every tenant.
 *
 * Deliberately additive and reversible. For each column this:
 *
 *   1. widens it to text, because ciphertext is far longer than the plaintext
 *      it replaces (pan_number was string(10));
 *   2. adds `<column>_bidx`, a keyed deterministic index so equality lookups
 *      still work — see App\Support\BlindIndex;
 *   3. adds `<column>_plain_backup` and copies the plaintext into it;
 *   4. rewrites the column itself as ciphertext.
 *
 * The plaintext survives in the backup column until a SEPARATE migration drops
 * it, which is run by hand once `php artisan pii:verify-encryption` reports
 * clean. Until then this is fully reversible, which matters because the data
 * being rewritten is the data payroll cannot be regenerated without.
 */
return new class extends Migration
{
    /**
     * table => [columns]
     *
     * ifsc_swift is deliberately absent. An IFSC identifies a bank branch and
     * is published by the RBI — encrypting it protects nothing, and several
     * completeness checks query it with whereNotNull.
     */
    private const TARGETS = [
        'employee_profiles' => ['pan_number', 'uan_number', 'esi_ip_number'],
        'employee_bank_accounts' => ['account_number', 'upi_id'],
        'employee_government_ids' => ['id_number'],
    ];

    public function up(): void
    {
        foreach (self::TARGETS as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column)) {
                    continue;
                }

                Schema::table($table, function (Blueprint $blueprint) use ($table, $column) {
                    if (! Schema::hasColumn($table, $column.'_bidx')) {
                        $blueprint->string($column.'_bidx', 64)->nullable();
                        $blueprint->index($column.'_bidx');
                    }

                    if (! Schema::hasColumn($table, $column.'_plain_backup')) {
                        $blueprint->text($column.'_plain_backup')->nullable();
                    }

                    // Ciphertext does not fit in string(10).
                    $blueprint->text($column)->nullable()->change();
                });

                $this->encryptExisting($table, $column);
            }
        }
    }

    /**
     * Rewrite every existing row: plaintext to the backup column, ciphertext
     * into the column itself, index alongside.
     *
     * Chunked by id so this does not load a large tenant's employee table into
     * memory, and skips anything already encrypted so a re-run cannot
     * double-encrypt.
     */
    private function encryptExisting(string $table, string $column): void
    {
        DB::table($table)
            ->select(['id', $column, $column.'_plain_backup'])
            ->whereNotNull($column)
            ->orderBy('id')
            ->chunkById(500, function ($rows) use ($table, $column) {
                foreach ($rows as $row) {
                    // Already converted on an earlier run: the backup is set.
                    if ($row->{$column.'_plain_backup'} !== null) {
                        continue;
                    }

                    $plain = (string) $row->{$column};

                    if (trim($plain) === '') {
                        continue;
                    }

                    DB::table($table)->where('id', $row->id)->update([
                        $column.'_plain_backup' => $plain,
                        $column => Crypt::encryptString($plain),
                        $column.'_bidx' => BlindIndex::of($plain),
                    ]);
                }
            });
    }

    public function down(): void
    {
        foreach (self::TARGETS as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column.'_plain_backup')) {
                    continue;
                }

                // Restore the plaintext before removing the scaffolding, or
                // rolling back would leave ciphertext in a plain column.
                DB::table($table)
                    ->whereNotNull($column.'_plain_backup')
                    ->orderBy('id')
                    ->chunkById(500, function ($rows) use ($table, $column) {
                        foreach ($rows as $row) {
                            DB::table($table)->where('id', $row->id)->update([
                                $column => $row->{$column.'_plain_backup'},
                            ]);
                        }
                    });

                Schema::table($table, function (Blueprint $blueprint) use ($table, $column) {
                    if (Schema::hasColumn($table, $column.'_bidx')) {
                        $blueprint->dropIndex([$column.'_bidx']);
                        $blueprint->dropColumn($column.'_bidx');
                    }

                    $blueprint->dropColumn($column.'_plain_backup');
                });
            }
        }
    }
};
