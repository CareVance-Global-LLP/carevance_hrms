<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class CreateSuperAdminSeeder extends Seeder
{
    public function run(): void
    {
        // Check if super admin already exists
        if (!User::where('email', 'superadmin@carevance.com')->exists()) {
            // Create Super Admin Organization
            $superOrg = Organization::create([
                'name' => 'CareVance Super Admin',
                'slug' => 'carevance-super-admin',
                'plan_code' => 'super_admin',
                'subscription_status' => 'active',
                'max_seats' => 100,
            ]);

            // Create Super Admin User
            $superAdmin = User::create([
                'name' => 'Super Admin',
                'email' => 'superadmin@carevance.com',
                'password' => Hash::make('SuperAdmin123!'),
                'role' => 'super_admin',
                'organization_id' => $superOrg->id,
                'email_verified_at' => now(),
            ]);

            // Update organization owner
            $superOrg->update(['owner_user_id' => $superAdmin->id]);

            $this->command->info('Super Admin created: superadmin@carevance.com / SuperAdmin123!');
        } else {
            $this->command->info('Super Admin already exists: superadmin@carevance.com / SuperAdmin123!');
        }

        // Create Admin user with the credentials you're trying to use (if not exists)
        if (!User::where('email', 'admin@carevance.com')->exists()) {
            $adminOrg = Organization::create([
                'name' => 'CareVance Admin',
                'slug' => 'carevance-admin',
                'plan_code' => 'enterprise',
                'subscription_status' => 'active',
                'max_seats' => 50,
            ]);

            $admin = User::create([
                'name' => 'Admin',
                'email' => 'admin@carevance.com',
                'password' => Hash::make('Admin123!'),
                'role' => 'admin',
                'organization_id' => $adminOrg->id,
                'email_verified_at' => now(),
            ]);

            $adminOrg->update(['owner_user_id' => $admin->id]);

            $this->command->info('Admin created: admin@carevance.com / Admin123!');
        } else {
            $this->command->info('Admin already exists: admin@carevance.com / Admin123!');
        }

        $this->command->info('=================================');
        $this->command->info('SUPER ADMIN: superadmin@carevance.com / SuperAdmin123!');
        $this->command->info('ADMIN: admin@carevance.com / Admin123!');
        $this->command->info('=================================');
    }
}
