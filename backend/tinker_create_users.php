<?php
use App\Models\User;
use App\Models\Organization;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\DB;

$org = Organization::firstOrCreate(
  ['slug' => 'qa-super-org'],
  ['name' => 'QA Super Org', 'plan_code' => 'super_admin', 'subscription_status' => 'active', 'max_seats' => 10]
);
$sa = User::firstOrCreate(
  ['email' => 'qa.superadmin@carevance.test'],
  [
    'name' => 'QA Super Admin',
    'password' => Hash::make('QaTest123!'),
    'role' => 'super_admin',
    'organization_id' => $org->id,
    'email_verified_at' => now(),
  ]
);
echo "superadmin id=" . $sa->id . " role=" . $sa->role . "\n";

$role = DB::table('roles')->firstOrCreate(
  ['slug' => 'qa-limited', 'organization_id' => 1],
  [
    'name' => 'QA Limited Role',
    'hierarchy_level' => 100,
    'is_system' => false,
    'is_active' => true,
    'color' => 'slate',
    'description' => 'Limited custom role for QA',
  ]
);
$customUser = User::firstOrCreate(
  ['email' => 'qa.customrole@carevance.test'],
  [
    'name' => 'QA Custom Role',
    'password' => Hash::make('QaTest123!'),
    'role' => 'employee',
    'organization_id' => 1,
    'role_id' => $role->id,
    'role_name' => 'QA Limited Role',
    'permissions' => json_encode(['assets.view']),
    'email_verified_at' => now(),
  ]
);
echo "custom role user id=" . $customUser->id . " permissions=" . $customUser->permissions . "\n";
echo "DONE\n";
