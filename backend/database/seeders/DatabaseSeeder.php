<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Find existing organization or create new one
        $organization = Organization::firstOrCreate(
            ['slug' => 'ayush-company'],
            [
                'name' => 'Ayush Company',
                'plan_code' => 'basic',
                'billing_cycle' => 'monthly',
                'subscription_status' => 'trial',
                'subscription_intent' => 'trial',
                'trial_starts_at' => now(),
                'trial_ends_at' => now()->addDays(14),
                'subscription_expires_at' => now()->addDays(14)->toDateString(),
                'max_seats' => 5,
            ]
        );

        // Create Ayush as admin with organization (if not exists)
        $ayush = User::firstOrCreate(
            ['email' => 'ayushborwal004@gmail.com'],
            [
                'name' => 'Ayush Borwal',
                'password' => bcrypt('12345678'),
                'role' => 'admin',
                'organization_id' => $organization->id,
                'email_verified_at' => now(),
            ]
        );

        // Set organization owner
        if (!$organization->owner_user_id) {
            $organization->update(['owner_user_id' => $ayush->id]);
        }

        // Create test user (if not exists)
        User::firstOrCreate(
            ['email' => 'test@example.com'],
            [
                'name' => 'Test User',
                'password' => bcrypt('12345678'),
            ]
        );

        // Create 5 employee users in the organization
        $employeeNames = [
            ['name' => 'Test Employee 1', 'email' => 'test1@gmail.com'],
            ['name' => 'Test Employee 2', 'email' => 'test2@gmail.com'],
            ['name' => 'Test Employee 3', 'email' => 'test3@gmail.com'],
            ['name' => 'Test Employee 4', 'email' => 'test4@gmail.com'],
            ['name' => 'Test Employee 5', 'email' => 'test5@gmail.com'],
        ];

        foreach ($employeeNames as $employee) {
            User::firstOrCreate(
                ['email' => $employee['email']],
                [
                    'name' => $employee['name'],
                    'password' => bcrypt('12345678'),
                    'role' => 'employee',
                    'organization_id' => $organization->id,
                    'email_verified_at' => now(),
                ]
            );
        }

        // Seed comprehensive demo data for all entities
        $this->call(ComprehensiveDemoSeeder::class);
    }
}
