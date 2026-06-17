<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_subscription_status_check');
            DB::statement("ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_status_check CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'expired', 'inactive'))");
        }
        // On sqlite/mysql the column has no CHECK constraint; nothing to do.
    }

    public function down(): void
    {
        DB::statement("UPDATE organizations SET subscription_status = 'trial' WHERE subscription_status = 'inactive'");

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_subscription_status_check');
            DB::statement("ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_status_check CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'expired'))");
        }
    }
};
