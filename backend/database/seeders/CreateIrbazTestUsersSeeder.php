<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use App\Models\Group;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class CreateIrbazTestUsersSeeder extends Seeder
{
    public function run(): void
    {
        $this->command->info('Creating Irbaz Test Organization and users...');

        // Create or get the Carevance Test organization
        $organization = Organization::firstOrCreate(
            ['slug' => 'carevance-test-irbaz'],
            [
                'name' => 'Carevance Test',
                'slug' => 'carevance-test-irbaz',
                'plan_code' => 'enterprise',
                'subscription_status' => 'active',
                'max_seats' => 10,
            ]
        );

        $this->command->info('Organization: ' . $organization->name);

        // Create IT Group
        $itGroup = Group::firstOrCreate(
            ['name' => 'IT', 'organization_id' => $organization->id],
            [
                'name' => 'IT',
                'description' => 'Information Technology Department',
                'organization_id' => $organization->id,
                'is_active' => true,
            ]
        );

        // Create Digital Marketing Group
        $digitalMarketingGroup = Group::firstOrCreate(
            ['name' => 'Digital Marketing', 'organization_id' => $organization->id],
            [
                'name' => 'Digital Marketing',
                'description' => 'Digital Marketing Department',
                'organization_id' => $organization->id,
                'is_active' => true,
            ]
        );

        $this->command->info('Created groups: IT, Digital Marketing');

        // 1. Admin - irbaz@test.com
        $admin = User::firstOrCreate(
            ['email' => 'irbaz@test.com'],
            [
                'name' => 'Irbaz',
                'email' => 'irbaz@test.com',
                'password' => Hash::make('password123'),
                'role' => 'admin',
                'organization_id' => $organization->id,
                'email_verified_at' => now(),
            ]
        );

        if (!$organization->owner_user_id) {
            $organization->update(['owner_user_id' => $admin->id]);
        }

        $this->command->info('Created Admin: irbaz@test.com / password123');

        // 2. Manager - ayush@test.com (IT Manager)
        $ayush = User::firstOrCreate(
            ['email' => 'ayush@test.com'],
            [
                'name' => 'Ayush',
                'email' => 'ayush@test.com',
                'password' => Hash::make('password123'),
                'role' => 'manager',
                'organization_id' => $organization->id,
                'email_verified_at' => now(),
            ]
        );

        $this->command->info('Created Manager (IT): ayush@test.com / password123');

        // 3. Employee - zeel@test.com (IT Employee)
        $zeel = User::firstOrCreate(
            ['email' => 'zeel@test.com'],
            [
                'name' => 'Zeel',
                'email' => 'zeel@test.com',
                'password' => Hash::make('password123'),
                'role' => 'employee',
                'organization_id' => $organization->id,
                'email_verified_at' => now(),
            ]
        );

        $this->command->info('Created Employee (IT): zeel@test.com / password123');

        // 4. Manager - adi@test.com (Digital Marketing Manager)
        $adi = User::firstOrCreate(
            ['email' => 'adi@test.com'],
            [
                'name' => 'Adi',
                'email' => 'adi@test.com',
                'password' => Hash::make('password123'),
                'role' => 'manager',
                'organization_id' => $organization->id,
                'email_verified_at' => now(),
            ]
        );

        $this->command->info('Created Manager (Digital Marketing): adi@test.com / password123');

        // 5. Employee - manan@test.com (Digital Marketing Employee)
        $manan = User::firstOrCreate(
            ['email' => 'manan@test.com'],
            [
                'name' => 'Manan',
                'email' => 'manan@test.com',
                'password' => Hash::make('password123'),
                'role' => 'employee',
                'organization_id' => $organization->id,
                'email_verified_at' => now(),
            ]
        );

        $this->command->info('Created Employee (Digital Marketing): manan@test.com / password123');

        // Summary
        $this->command->info('');
        $this->command->info('========================================');
        $this->command->info('Irbaz Test Organization Users Created!');
        $this->command->info('========================================');
        $this->command->info('Organization: Carevance Test');
        $this->command->info('');
        $this->command->info('1. ADMIN: irbaz@test.com / password123');
        $this->command->info('2. MANAGER (IT): ayush@test.com / password123');
        $this->command->info('3. EMPLOYEE (IT): zeel@test.com / password123');
        $this->command->info('4. MANAGER (Digital Marketing): adi@test.com / password123');
        $this->command->info('5. EMPLOYEE (Digital Marketing): manan@test.com / password123');
        $this->command->info('========================================');
    }
}
