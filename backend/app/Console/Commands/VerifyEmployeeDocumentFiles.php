<?php

namespace App\Console\Commands;

use App\Models\ChecklistItem;
use App\Models\EmployeeDocument;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Finds document rows whose file is not actually on the disk.
 *
 * Until the guard in `EmployeeWorkspaceService::storeDocument()`, a storage
 * write that failed produced a perfectly ordinary-looking row: the API returned
 * 201, the panel said "saved successfully", and any onboarding item waiting on
 * that document ticked itself. Nothing disagreed with it until somebody went
 * looking for the scan — typically at the point they needed it.
 *
 * This is the sweep for rows already written that way. It reads only; deleting
 * a row is not a decision a command should take, because a missing file might
 * equally mean a bucket was moved and the fix is to restore it, not to erase
 * the record that it existed.
 *
 * Also reports checklist items completed by an absent document, since those are
 * the ones actively making a false statement.
 */
class VerifyEmployeeDocumentFiles extends Command
{
    protected $signature = 'documents:verify-files
                            {--organization= : Limit to one organization id}';

    protected $description = 'Report employee documents whose file is missing from storage';

    public function handle(): int
    {
        $query = EmployeeDocument::withoutOrganizationScope()
            ->when($this->option('organization'), fn ($q, $id) => $q->where('organization_id', (int) $id))
            ->orderBy('id');

        $total = (clone $query)->count();

        if ($total === 0) {
            $this->info('No employee documents on record.');

            return self::SUCCESS;
        }

        $missing = [];

        $query->chunkById(200, function ($documents) use (&$missing) {
            foreach ($documents as $document) {
                if (! $this->fileIsPresent($document)) {
                    $missing[] = $document;
                }
            }
        });

        if ($missing === []) {
            $this->info(sprintf('All %d employee documents have a file on disk.', $total));

            return self::SUCCESS;
        }

        $this->error(sprintf('%d of %d employee documents have NO file on disk.', count($missing), $total));
        $this->newLine();

        /*
         * Grouped by disk before anything else, because the counts are not
         * comparable. ComprehensiveDemoSeeder writes 283 rows with invented
         * `/documents/xxx.pdf` paths on the `public` disk that never had files
         * and never will — listing those beside a genuinely lost upload buries
         * the one row that matters under demo data, which is how a real
         * problem gets scrolled past.
         */
        $byDisk = collect($missing)->groupBy(fn (EmployeeDocument $d) => $d->file_disk ?: '(none)');

        $this->table(
            ['disk', 'missing', 'note'],
            $byDisk->map(fn ($rows, $disk) => [
                $disk,
                $rows->count(),
                $disk === 'public' ? 'seeded demo rows — expected, never had files' : 'REAL uploads — investigate',
            ])->values()->all()
        );

        $real = collect($missing)->reject(fn (EmployeeDocument $d) => $d->file_disk === 'public')->values();

        if ($real->isEmpty()) {
            $this->newLine();
            $this->info('No real uploads are missing. Everything above is seeded demo data.');
            $this->reportAffectedChecklistItems(collect($missing)->pluck('id')->all());

            return self::SUCCESS;
        }

        $this->newLine();
        $this->error(sprintf('%d REAL upload(s) missing their file:', $real->count()));

        $this->table(
            ['id', 'org', 'user', 'category', 'title', 'disk', 'path'],
            $real->map(fn (EmployeeDocument $d) => [
                $d->id,
                $d->organization_id,
                $d->user_id,
                $d->category,
                mb_strimwidth((string) $d->title, 0, 30, '…'),
                $d->file_disk ?: '(none)',
                // An empty or "0" path is the signature of a store() that
                // returned false and was written anyway.
                $d->file_path === null || trim((string) $d->file_path) === '' ? '(EMPTY)' : mb_strimwidth((string) $d->file_path, 0, 40, '…'),
            ])->all()
        );

        $this->reportAffectedChecklistItems(collect($missing)->pluck('id')->all());

        // Non-zero so a deployment check or a cron can act on it.
        return self::FAILURE;
    }

    private function fileIsPresent(EmployeeDocument $document): bool
    {
        $path = trim((string) $document->file_path);

        if ($path === '' || $path === '0') {
            return false;
        }

        foreach (array_unique(array_filter([trim((string) $document->file_disk), 'employee_documents', 'local'])) as $disk) {
            try {
                if (Storage::disk($disk)->exists($path)) {
                    return true;
                }
            } catch (\Throwable) {
                // An unconfigured or unreachable disk is not proof the file is
                // absent, but it is not proof it is present either — keep
                // looking, and fall through to "missing" if nothing answers.
                continue;
            }
        }

        return false;
    }

    /** @param array<int, int> $documentIds */
    private function reportAffectedChecklistItems(array $documentIds): void
    {
        $items = ChecklistItem::withoutOrganizationScope()
            ->whereIn('employee_document_id', $documentIds)
            ->get();

        if ($items->isEmpty()) {
            return;
        }

        $this->newLine();
        $this->error(sprintf(
            '%d checklist item(s) are marked complete by one of those missing documents:',
            $items->count()
        ));

        foreach ($items as $item) {
            $this->line(sprintf(
                '  item %d  "%s"  on %s %d  (document %d)',
                $item->id,
                $item->title,
                class_basename((string) $item->subject_type),
                $item->subject_id,
                $item->employee_document_id
            ));
        }

        $this->newLine();
        $this->comment('Reopen those items once you know whether the file is recoverable — they currently assert evidence that is not there.');
    }
}
