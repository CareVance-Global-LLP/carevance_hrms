<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The irreversible half of encrypting employee PII.
 *
 * Deliberately a command and not a migration. A migration runs itself on the
 * next deploy, which would throw the plaintext away before anyone had looked
 * at the verification report — defeating the entire point of keeping it. This
 * is an operator decision, taken once, after `pii:verify-encryption` reports
 * clean.
 *
 * After this runs there is no way back to the plaintext except from a database
 * backup taken before it.
 */
class DropPiiPlaintextBackups extends Command
{
    protected $signature = 'pii:drop-plaintext-backups {--force : Skip the confirmation prompt}';

    protected $description = 'Permanently remove the retained plaintext PII columns (run pii:verify-encryption first)';

    private const TARGETS = [
        'employee_profiles' => ['pan_number', 'uan_number', 'esi_ip_number'],
        'employee_bank_accounts' => ['account_number', 'upi_id'],
        'employee_government_ids' => ['id_number'],
    ];

    public function handle(): int
    {
        $this->warn('This permanently deletes the retained plaintext copies of employee PAN,');
        $this->warn('Aadhaar, UAN, ESI, bank account and UPI values. It cannot be undone.');
        $this->newLine();

        // Verify first, always. Dropping the only copy of the plaintext on the
        // strength of an unchecked assumption is how data loss happens.
        $this->line('Re-running verification before dropping anything...');

        if ($this->call('pii:verify-encryption') !== self::SUCCESS) {
            $this->error('Verification failed. Nothing was dropped.');

            return self::FAILURE;
        }

        $this->newLine();

        if (! $this->option('force') && ! $this->confirm('Verification passed. Drop the plaintext backup columns now?', false)) {
            $this->line('Nothing was dropped.');

            return self::SUCCESS;
        }

        $dropped = 0;

        foreach (self::TARGETS as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            foreach ($columns as $column) {
                $backup = $column.'_plain_backup';

                if (! Schema::hasColumn($table, $backup)) {
                    continue;
                }

                Schema::table($table, function (Blueprint $blueprint) use ($backup) {
                    $blueprint->dropColumn($backup);
                });

                $this->line("  dropped {$table}.{$backup}");
                $dropped++;
            }
        }

        $this->newLine();
        $this->info("Done. {$dropped} plaintext column(s) removed.");

        return self::SUCCESS;
    }
}
