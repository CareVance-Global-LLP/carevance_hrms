<?php

namespace App\Console\Commands;

use App\Support\BlindIndex;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Prove that encrypting employee PII lost nothing before the plaintext is
 * thrown away.
 *
 * The phase-one migration keeps every original value in a `_plain_backup`
 * column precisely so this can be checked rather than assumed. Run this, read
 * the report, and only then run `pii:drop-plaintext-backups`.
 *
 * A green run means, for every row: the ciphertext decrypts, it decrypts to
 * exactly the original, and the blind index matches what a lookup would
 * compute. The third check matters as much as the first two — an index that
 * disagrees does not error, it just silently stops matching, so a PAN lookup
 * quietly finds nobody and a duplicate check quietly finds no duplicates.
 */
class VerifyPiiEncryption extends Command
{
    protected $signature = 'pii:verify-encryption {--sample=0 : Check only this many rows per column (0 = all)}';

    protected $description = 'Verify encrypted PII decrypts back to the retained plaintext and its blind index matches';

    private const TARGETS = [
        'employee_profiles' => ['pan_number', 'uan_number', 'esi_ip_number'],
        'employee_bank_accounts' => ['account_number', 'upi_id'],
        'employee_government_ids' => ['id_number'],
    ];

    public function handle(): int
    {
        $sample = max(0, (int) $this->option('sample'));
        $totalChecked = 0;
        $problems = [];

        foreach (self::TARGETS as $table => $columns) {
            if (! Schema::hasTable($table)) {
                $this->warn("Skipping {$table}: table not present.");

                continue;
            }

            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column.'_plain_backup')) {
                    $this->warn("Skipping {$table}.{$column}: no backup column — already dropped, or never migrated.");

                    continue;
                }

                [$checked, $found] = $this->verifyColumn($table, $column, $sample);
                $totalChecked += $checked;
                $problems = array_merge($problems, $found);

                $this->line(sprintf(
                    '  %-28s %6d row(s) checked%s',
                    "{$table}.{$column}",
                    $checked,
                    $found === [] ? '' : '   <fg=red>'.count($found).' PROBLEM(S)</>'
                ));
            }
        }

        $this->newLine();

        if ($problems === []) {
            $this->info("OK: {$totalChecked} value(s) verified. Every one decrypts to its original and indexes correctly.");
            $this->line('Safe to run: php artisan pii:drop-plaintext-backups');

            return self::SUCCESS;
        }

        $this->error(count($problems).' problem(s) found. DO NOT drop the plaintext backups.');
        $this->newLine();

        foreach (array_slice($problems, 0, 50) as $problem) {
            $this->line('  - '.$problem);
        }

        if (count($problems) > 50) {
            $this->line('  ... and '.(count($problems) - 50).' more.');
        }

        return self::FAILURE;
    }

    /**
     * @return array{0:int, 1:array<int,string>}
     */
    private function verifyColumn(string $table, string $column, int $sample): array
    {
        $problems = [];
        $checked = 0;

        $query = DB::table($table)
            ->select(['id', $column, $column.'_bidx', $column.'_plain_backup'])
            ->whereNotNull($column.'_plain_backup')
            ->orderBy('id');

        if ($sample > 0) {
            $query->limit($sample);
        }

        foreach ($query->cursor() as $row) {
            $checked++;

            $original = (string) $row->{$column.'_plain_backup'};
            $stored = $row->{$column};

            if ($stored === null) {
                $problems[] = "{$table}#{$row->id}.{$column}: had a value, now NULL.";

                continue;
            }

            try {
                $decrypted = Crypt::decryptString((string) $stored);
            } catch (\Throwable $e) {
                $problems[] = "{$table}#{$row->id}.{$column}: will not decrypt ({$e->getMessage()}).";

                continue;
            }

            if ($decrypted !== $original) {
                // The values themselves are deliberately not printed — this
                // output ends up in terminal scrollback and CI logs.
                $problems[] = "{$table}#{$row->id}.{$column}: decrypts to a different value than the original.";

                continue;
            }

            $expectedIndex = BlindIndex::of($original);

            if ($row->{$column.'_bidx'} !== $expectedIndex) {
                $problems[] = "{$table}#{$row->id}.{$column}: blind index does not match — lookups on this row will silently find nothing.";
            }
        }

        return [$checked, $problems];
    }
}
