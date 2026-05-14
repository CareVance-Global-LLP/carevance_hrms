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
        // Create organization first
        $organization = Organization::create([
            'name' => 'Test Organization',
            'slug' => 'test-organization',
            'plan_code' => 'starter',
        ]);

        // Create user with your email
        $user = User::create([
            'name' => 'Ayush Borwal',
            'email' => 'ayushborwal004@gmail.com',
            'password' => Hash::make('12345678'),
            'role' => 'admin',
            'organization_id' => $organization->id,
            'email_verified_at' => now(), // Auto-verify for testing
        ]);

        // Set organization owner
        $organization->update(['owner_user_id' => $user->id]);

        $this->command->info('Test user created successfully!');
        $this->command->info('Email: ayushborwal004@gmail.com');
        $this->command->info('Password: 12345678');
    }
}
