<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make('Illuminate\Contracts\Console\Kernel')->bootstrap();

// Update existing user to be accessible as super admin
$user = App\Models\User::where('email', 'ayushborwal004@gmail.com')->first();

if ($user) {
    // Keep the user as admin but update email for super admin access
    $user->email = 'superadmin@carevance.com';
    $user->save();
    
    echo "=================================\n";
    echo "SUPER ADMIN ACCESS CONFIGURED\n";
    echo "=================================\n";
    echo "Email: superadmin@carevance.com\n";
    echo "Password: 12345678 (your existing password)\n";
    echo "Role: admin (with super admin routes)\n";
    echo "=================================\n";
    echo "\nTo access Super Admin Panel:\n";
    echo "1. Login with above credentials\n";
    echo "2. Navigate to: /super-admin\n";
    echo "=================================\n";
} else {
    echo "User not found!\n";
}
