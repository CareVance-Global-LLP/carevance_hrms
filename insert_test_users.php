<?php

/**
 * Script to create test users
 * Run: php insert_test_users.php
 */

require_once __DIR__ . '/backend/vendor/autoload.php';

use Illuminate\Database\Capsule\Manager as Capsule;
use Illuminate\Support\Facades\Hash;

// Initialize Laravel Database
$app = require_once __DIR__ . '/backend/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

// Test user data
$users = [
    [
        'name' => 'test1',
        'email' => 'test1@test.com',
        'password' => '12345678',
        'role' => 'employee',
    ],
    [
        'name' => 'test2',
        'email' => 'test2@test.com',
        'password' => '12345678',
        'role' => 'manager',
    ],
];

echo "Creating test users...\n\n";

foreach ($users as $userData) {
    // Check if user already exists
    $existingUser = DB::table('users')->where('email', $userData['email'])->first();
    
    if ($existingUser) {
        echo "User {$userData['email']} already exists. Skipping.\n";
        continue;
    }
    
    // Get first organization
    $organization = DB::table('organizations')->first();
    
    if (!$organization) {
        echo "Creating default organization...\n";
        $orgId = DB::table('organizations')->insertGetId([
            'name' => 'Test Organization',
            'slug' => 'test-org',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    } else {
        $orgId = $organization->id;
    }
    
    // Create user with hashed password
    $userId = DB::table('users')->insertGetId([
        'name' => $userData['name'],
        'email' => $userData['email'],
        'password_hash' => Hash::make($userData['password']),
        'role' => $userData['role'],
        'organization_id' => $orgId,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    
    echo "✓ Created user: {$userData['name']} ({$userData['email']})\n";
    echo "  Role: {$userData['role']}\n";
    echo "  Password: {$userData['password']}\n";
    echo "  Organization ID: {$orgId}\n\n";
}

echo "Done! Test users created successfully.\n";
echo "\nLogin credentials:\n";
echo "  Employee: test1@test.com / 12345678\n";
echo "  Manager:  test2@test.com / 12345678\n";
