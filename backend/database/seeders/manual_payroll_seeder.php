<?php

/**
 * Manual Payroll Data Seeder - SQL Version
 * Run this in your database directly or via php artisan tinker
 */

// Get your organization ID first
$organizationId = 1; // Change this to your actual organization ID

echo "Creating payroll test data for Organization ID: {$organizationId}\n";

// 1. Create Departments
$departments = [
    ['name' => 'Digital Marketing', 'code' => 'DM'],
    ['name' => 'IT', 'code' => 'IT'],
    ['name' => 'Quality Assurance', 'code' => 'QA'],
];

echo "\n=== CREATING DEPARTMENTS ===\n";
foreach ($departments as $dept) {
    $existing = DB::table('groups')->where('name', $dept['name'])->where('organization_id', $organizationId)->first();
    
    if (!$existing) {
        $id = DB::table('groups')->insertGetId([
            'organization_id' => $organizationId,
            'name' => $dept['name'],
            'code' => $dept['code'],
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        echo "✓ Created department: {$dept['name']} (ID: {$id})\n";
    } else {
        echo "✓ Department exists: {$dept['name']} (ID: {$existing->id})\n";
    }
}

// Get all department IDs
$deptIds = DB::table('groups')->where('organization_id', $organizationId)->pluck('id', 'name');
echo "\nDepartment IDs: " . json_encode($deptIds->toArray()) . "\n";

// 2. Create Users
echo "\n=== CREATING USERS ===\n";

$users = [
    ['name' => 'Rahul Sharma', 'email' => 'rahul.sharma@test.com', 'role' => 'employee', 'dept' => 'Digital Marketing'],
    ['name' => 'Priya Patel', 'email' => 'priya.patel@test.com', 'role' => 'employee', 'dept' => 'Digital Marketing'],
    ['name' => 'Amit Kumar', 'email' => 'amit.kumar@test.com', 'role' => 'employee', 'dept' => 'Digital Marketing'],
    ['name' => 'Sneha Gupta', 'email' => 'sneha.gupta@test.com', 'role' => 'employee', 'dept' => 'IT'],
    ['name' => 'Vikram Rao', 'email' => 'vikram.rao@test.com', 'role' => 'employee', 'dept' => 'Quality Assurance'],
    ['name' => 'Neha Singh', 'email' => 'neha.singh@test.com', 'role' => 'employee', 'dept' => 'Quality Assurance'],
    ['name' => 'Arun Verma', 'email' => 'arun.verma@test.com', 'role' => 'employee', 'dept' => 'Quality Assurance'],
    ['name' => 'Kiran Desai', 'email' => 'kiran.desai@test.com', 'role' => 'employee', 'dept' => null], // Unassigned
];

foreach ($users as $i => $userData) {
    $existing = DB::table('users')->where('email', $userData['email'])->first();
    
    if (!$existing) {
        $userId = DB::table('users')->insertGetId([
            'organization_id' => $organizationId,
            'name' => $userData['name'],
            'email' => $userData['email'],
            'password' => bcrypt('password123'),
            'role' => $userData['role'],
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        echo "✓ Created user: {$userData['name']} (ID: {$userId})\n";
    } else {
        $userId = $existing->id;
        echo "✓ User exists: {$userData['name']} (ID: {$userId})\n";
    }
    
    // Create employee profile
    $profileExists = DB::table('employee_profiles')->where('user_id', $userId)->first();
    if (!$profileExists) {
        DB::table('employee_profiles')->insert([
            'user_id' => $userId,
            'organization_id' => $organizationId,
            'pan_number' => 'ABCDE' . str_pad($i + 1000, 4, '0', STR_PAD_LEFT) . 'F',
            'uan_number' => strval(100000000000 + $i),
            'esi_ip_number' => '1234567890' . str_pad($i, 7, '0', STR_PAD_LEFT),
            'tax_regime' => 'new',
            'is_metro_city' => true,
            'pt_state' => 'maharashtra',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
    
    // Create employee work info
    $workInfoExists = DB::table('employee_work_infos')->where('user_id', $userId)->first();
    if (!$workInfoExists) {
        DB::table('employee_work_infos')->insert([
            'user_id' => $userId,
            'employee_code' => 'EMP' . str_pad($userId, 4, '0', STR_PAD_LEFT),
            'designation' => 'Employee',
            'joining_date' => now()->subYears(rand(1, 3))->format('Y-m-d'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
    
    // Create bank account
    $bankExists = DB::table('employee_bank_accounts')->where('user_id', $userId)->where('is_primary', true)->first();
    if (!$bankExists) {
        DB::table('employee_bank_accounts')->insert([
            'user_id' => $userId,
            'account_number' => '1234567890' . str_pad($userId, 4, '0', STR_PAD_LEFT),
            'ifsc_swift' => 'HDFC0001234',
            'bank_name' => 'HDFC Bank',
            'account_holder_name' => $userData['name'],
            'is_primary' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
    
    // Create payroll template
    $templateExists = DB::table('employee_payroll_templates')->where('user_id', $userId)->first();
    if (!$templateExists) {
        $ctc = [600000, 720000, 480000, 1200000, 960000, 840000, 660000, 360000][$i] ?? 600000;
        DB::table('employee_payroll_templates')->insert([
            'user_id' => $userId,
            'organization_id' => $organizationId,
            'annual_ctc' => $ctc,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'medical_allowance' => 1250,
            'pf_enabled' => true,
            'esi_enabled' => true,
            'pt_enabled' => true,
            'tds_enabled' => true,
            'tax_regime' => 'new',
            'is_metro_city' => true,
            'pt_state' => 'maharashtra',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
    
    // Assign to department
    if ($userData['dept'] && isset($deptIds[$userData['dept']])) {
        $deptId = $deptIds[$userData['dept']];
        
        $assignmentExists = DB::table('group_user')
            ->where('group_id', $deptId)
            ->where('user_id', $userId)
            ->first();
        
        if (!$assignmentExists) {
            DB::table('group_user')->insert([
                'group_id' => $deptId,
                'user_id' => $userId,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            echo "  → Assigned to: {$userData['dept']}\n";
        }
    } else {
        echo "  → Not assigned to any department\n";
    }
}

// 3. Summary
echo "\n=== SUMMARY ===\n";
$userCount = DB::table('users')->where('organization_id', $organizationId)->whereIn('role', ['employee', 'manager', 'admin'])->count();
$deptCount = DB::table('groups')->where('organization_id', $organizationId)->count();
$assignmentCount = DB::table('group_user')
    ->join('groups', 'group_user.group_id', '=', 'groups.id')
    ->where('groups.organization_id', $organizationId)
    ->count();

echo "Total Users: {$userCount}\n";
echo "Total Departments: {$deptCount}\n";
echo "Total Assignments: {$assignmentCount}\n";

echo "\n=== TEST CREDENTIALS ===\n";
echo "All users can login with:\n";
echo "Password: password123\n\n";
foreach ($users as $user) {
    echo "  - {$user['name']}: {$user['email']}\n";
}

echo "\n✅ Payroll test data created successfully!\n";
