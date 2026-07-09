<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private array $permissions = [
        ['key' => 'assets.view', 'name' => 'View Assets', 'group_name' => 'Assets', 'description' => 'View the asset registry and assignments'],
        ['key' => 'assets.manage', 'name' => 'Manage Assets', 'group_name' => 'Assets', 'description' => 'Create, edit, assign and return company assets'],
    ];

    public function up(): void
    {
        foreach ($this->permissions as $perm) {
            $exists = DB::table('permissions')->where('key', $perm['key'])->exists();
            if ($exists) {
                continue;
            }

            DB::table('permissions')->insert([
                'key' => $perm['key'],
                'name' => $perm['name'],
                'group_name' => $perm['group_name'],
                'description' => $perm['description'],
                'plan_feature' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        $keys = array_column($this->permissions, 'key');

        $permIds = DB::table('permissions')->whereIn('key', $keys)->pluck('id');
        if ($permIds->isNotEmpty()) {
            DB::table('role_permissions')->whereIn('permission_id', $permIds)->delete();
        }

        DB::table('permissions')->whereIn('key', $keys)->delete();
    }
};
