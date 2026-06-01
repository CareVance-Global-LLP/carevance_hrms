<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Remove payroll and invoices permissions from roles
        DB::table('role_permissions')
            ->whereIn('permission_id', function ($query) {
                $query->select('id')
                    ->from('permissions')
                    ->whereIn('key', ['payroll.view', 'invoices.view']);
            })
            ->delete();

        // Delete the permissions themselves
        DB::table('permissions')
            ->whereIn('key', ['payroll.view', 'invoices.view'])
            ->delete();
    }

    public function down(): void
    {
        // Restore permissions if needed
        $permissions = [
            ['key' => 'payroll.view', 'name' => 'View Payroll', 'group_name' => 'Payroll', 'plan_feature' => null],
            ['key' => 'invoices.view', 'name' => 'View Invoices', 'group_name' => 'Invoices', 'plan_feature' => null],
        ];

        foreach ($permissions as $perm) {
            DB::table('permissions')->insert([
                'key' => $perm['key'],
                'name' => $perm['name'],
                'group_name' => $perm['group_name'],
                'description' => null,
                'plan_feature' => $perm['plan_feature'],
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }
};
