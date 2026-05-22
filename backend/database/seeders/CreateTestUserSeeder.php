<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class CreateTestUserSeeder extends Seeder
{
    public function run(): void
    {
        // Check if test users already exist
        $existingTest1 = User::where('email', 'test1@test.com')->first();
        $existingTest2 = User::where('email', 'test2@test.com')->first();
        $existingAdmin = User::where('email', 'ayushborwal004@gmail.com')->first();

        // Create organization first (or use existing)
        $organization = Organization::first();
        
        if (!$organization) {
            $organization = Organization::create([
                'name' => 'Test Organization',
                'slug' => 'test-organization',
                'plan_code' => 'basic',
                'max_seats' => 5,
            ]);
            $this->command->info('Created new organization: Test Organization');
        } else {
            $this->command->info('Using existing organization: ' . $organization->name);
        }

        // Create admin user if not exists
        if (!$existingAdmin) {
            $user = User::create([
                'name' => 'Ayush Borwal',
                'email' => 'ayushborwal004@gmail.com',
                'password' => Hash::make('12345678'),
                'role' => 'admin',
                'organization_id' => $organization->id,
                'email_verified_at' => now(),
            ]);
            // Set organization owner
            $organization->update(['owner_user_id' => $user->id]);
            $this->command->info('✓ Created admin user: ayushborwal004@gmail.com');
        } else {
            $this->command->info('ℹ Admin user already exists: ayushborwal004@gmail.com');
        }

        // Create test1 - Employee if not exists
        if (!$existingTest1) {
            User::create([
                'name' => 'test1',
                'email' => 'test1@test.com',
                'password' => Hash::make('12345678'),
                'role' => 'employee',
                'organization_id' => $organization->id,
                'email_verified_at' => now(),
            ]);
            $this->command->info('✓ Created employee user: test1@test.com');
        } else {
            $this->command->info('ℹ Employee user already exists: test1@test.com');
        }

        // Create test2 - Manager if not exists
        if (!$existingTest2) {
            User::create([
                'name' => 'test2',
                'email' => 'test2@test.com',
                'password' => Hash::make('12345678'),
                'role' => 'manager',
                'organization_id' => $organization->id,
                'email_verified_at' => now(),
            ]);
            $this->command->info('✓ Created manager user: test2@test.com');
        } else {
            $this->command->info('ℹ Manager user already exists: test2@test.com');
        }

        $this->command->info('');
        $this->command->info('========================================');
        $this->command->info('All test users created successfully!');
        $this->command->info('========================================');
        $this->command->info('');
        $this->command->info('Admin User:');
        $this->command->info('  Email: ayushborwal004@gmail.com');
        $this->command->info('  Password: 12345678');
        $this->command->info('  Role: admin');
        $this->command->info('');
        $this->command->info('Employee User:');
        $this->command->info('  Email: test1@test.com');
        $this->command->info('  Password: 12345678');
        $this->command->info('  Role: employee');
        $this->command->info('');
        $this->command->info('Manager User:');
        $this->command->info('  Email: test2@test.com');
        $this->command->info('  Password: 12345678');
        $this->command->info('  Role: manager');
        $this->command->info('');
        $this->command->info('========================================');
    }
}
