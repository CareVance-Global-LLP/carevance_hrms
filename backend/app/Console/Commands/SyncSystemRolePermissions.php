<?php

namespace App\Console\Commands;

use App\Models\Organization;
use App\Models\Permission;
use App\Models\Role;
use Illuminate\Console\Command;

/**
 * Bring every system role back up to the permission set its slug is supposed
 * to carry.
 *
 * WHY EXISTING ROLES DRIFT AND NEW ONES DO NOT
 *
 * Roles are seeded once, when an organisation is created, from a fixed list.
 * Nothing has ever revisited them — so a permission added to `User` afterwards
 * reaches an admin with NO custom role (that path reads the constant live) and
 * never reaches the seeded "Admin" role (that path read the constant once,
 * years ago). The two diverge silently, and the symptom is a 403 on a screen
 * the same person can reach from a different account.
 *
 * Found 25 Aug 2026: seven organisations' Admin roles lacked assets.view,
 * assets.manage, payroll.view and invoices.view; nine Manager roles lacked
 * those plus chat.use. The admin of org 1 could not open Assets at all.
 *
 * ADDITIVE ONLY, AND THAT IS THE POINT. A role someone has deliberately
 * widened keeps everything it has been given — this only tops up what the
 * baseline says it should always have had. Removing permissions here would
 * silently undo a deliberate grant, and there is no way to tell one from the
 * other after the fact.
 *
 * Non-system roles are skipped entirely: they exist precisely to differ.
 */
class SyncSystemRolePermissions extends Command
{
    protected $signature = 'roles:sync-permissions
        {--dry-run : Report what would be attached without writing}
        {--organization= : Limit to one organization id}';

    protected $description = 'Top up system roles with the baseline permissions their slug should carry';

    public function handle(): int
    {
        $defaults = Organization::systemRolePermissionDefaults();
        $dryRun = (bool) $this->option('dry-run');

        $roles = Role::withoutGlobalScopes()
            ->where('is_system', true)
            ->when($this->option('organization'), fn ($q, $id) => $q->where('organization_id', $id))
            ->orderBy('organization_id')
            ->orderBy('id')
            ->get();

        if ($roles->isEmpty()) {
            $this->info('No system roles found.');

            return self::SUCCESS;
        }

        $touched = 0;
        $attached = 0;

        foreach ($roles as $role) {
            $baseline = $defaults[$role->slug] ?? null;

            // A slug with no baseline is a role this command has no opinion
            // about. Silently granting it everything is what caused the
            // original drift.
            if ($baseline === null) {
                $this->line(sprintf('  #%-3d %-12s org=%-3s skipped (no baseline for this slug)',
                    $role->id, $role->name, $role->organization_id));
                continue;
            }

            $have = $role->permissions()->pluck('key');
            $missing = collect($baseline)->diff($have)->values();

            if ($missing->isEmpty()) {
                continue;
            }

            /*
             * Only keys that actually exist as rows can be attached. A key in
             * the constant with no row is a SEPARATE fault — reported here
             * rather than created, because inventing a permission row with a
             * guessed group_name and description puts a nameless entry in the
             * roles UI that nobody can explain.
             */
            $ids = Permission::whereIn('key', $missing)->pluck('id', 'key');
            $noRow = $missing->reject(fn ($key) => $ids->has($key));

            if ($noRow->isNotEmpty()) {
                $this->warn(sprintf('  #%-3d %-12s org=%-3s NO PERMISSION ROW: %s',
                    $role->id, $role->name, $role->organization_id, $noRow->implode(', ')));
            }

            if ($ids->isEmpty()) {
                continue;
            }

            $this->line(sprintf('  #%-3d %-12s org=%-3s %s: %s',
                $role->id, $role->name, $role->organization_id,
                $dryRun ? 'would attach' : 'attaching', $ids->keys()->implode(', ')));

            if (! $dryRun) {
                // syncWithoutDetaching, never sync: a deliberate extra grant on
                // this role must survive.
                $role->permissions()->syncWithoutDetaching($ids->values()->all());
            }

            $touched++;
            $attached += $ids->count();
        }

        $this->newLine();
        $this->info(sprintf('%s %d role(s), %d permission link(s).',
            $dryRun ? '[dry run] would touch' : 'Updated', $touched, $attached));

        return self::SUCCESS;
    }
}
