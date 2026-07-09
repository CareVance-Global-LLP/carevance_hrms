<?php

use App\Models\Role;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('roles', 'color')) {
            return;
        }

        // Recolor any role that has no color, an empty color, or the
        // default 'slate' placeholder so every role gets a level-based color.
        Role::query()
            ->whereNull('color')
            ->orWhere('color', '')
            ->orWhere('color', 'slate')
            ->get()
            ->each(function (Role $role) {
                $role->update([
                    'color' => Role::defaultColorForLevel((int) $role->hierarchy_level),
                ]);
            });
    }

    public function down(): void
    {
        // No-op: seeding is not reversible.
    }
};
