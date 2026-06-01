<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Move productivity.manage from Settings to its own Productivity group
        DB::table('permissions')
            ->where('key', 'productivity.manage')
            ->update(['group_name' => 'Productivity']);
    }

    public function down(): void
    {
        DB::table('permissions')
            ->where('key', 'productivity.manage')
            ->update(['group_name' => 'Settings']);
    }
};
