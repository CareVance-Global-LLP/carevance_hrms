<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\User;
use App\Models\Organization;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\DB;

function ensureUser($email, $attrs) {
  $u = User::where('email', $email)->first();
  if ($u) { echo "exists: $email (id={$u->id})\n"; return $u; }
  $attrs['email'] = $email;
  $u = User::create($attrs);
  echo "created: $email (id={$u->id})\n";
  return $u;
}

$org = Organization::where('slug', 'qa-super-org')->first();
if (!$org) {
  $org = Organization::create(['name' => 'QA Super Org', 'slug' => 'qa-super-org', 'plan_code' => 'super_admin', 'subscription_status' => 'active', 'max_seats' => 10]);
}
$sa = ensureUser('qa.superadmin@carevance.test', [
  'name' => 'QA Super Admin', 'password' => Hash::make('QaTest123!'), 'role' => 'super_admin', 'organization_id' => $org->id, 'email_verified_at' => now(),
]);
echo "superadmin role=" . $sa->role . "\n";

$limitedPermIds = [1, 2, 3, 7, 13]; // dashboard.view, timer.use, employees.view, attendance.view, leave.view

$role = DB::table('roles')->where('slug', 'qa-limited')->where('organization_id', 1)->first();
if (!$role) {
  $roleId = DB::table('roles')->insertGetId([
    'organization_id' => 1, 'name' => 'QA Limited Role', 'slug' => 'qa-limited', 'hierarchy_level' => 100,
    'is_system' => false, 'is_active' => true, 'color' => 'slate', 'description' => 'Limited custom role for QA', 'created_at' => now(), 'updated_at' => now(),
  ]);
  echo "created role id=$roleId\n";
  foreach ($limitedPermIds as $pid) {
    DB::table('role_permissions')->insertOrIgnore(['role_id' => $roleId, 'permission_id' => $pid, 'created_at' => now(), 'updated_at' => now()]);
  }
} else {
  echo "role exists id={$role->id}\n";
  $roleId = $role->id;
  DB::table('role_permissions')->where('role_id', $roleId)->delete();
  foreach ($limitedPermIds as $pid) {
    DB::table('role_permissions')->insertOrIgnore(['role_id' => $roleId, 'permission_id' => $pid, 'created_at' => now(), 'updated_at' => now()]);
  }
}

$cu = ensureUser('qa.customrole@carevance.test', [
  'name' => 'QA Custom Role', 'password' => Hash::make('QaTest123!'), 'role' => 'employee', 'organization_id' => 1,
  'role_id' => $roleId, 'email_verified_at' => now(),
]);
echo "custom role user id={$cu->id} role={$cu->role} role_id={$cu->role_id}\n";
echo "DONE\n";
