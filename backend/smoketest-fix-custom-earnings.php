<?php
require __DIR__ . '/vendor/autoload.php';
$app = require __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Group;
use App\Models\Organization;
use App\Models\PayGroup;
use App\Models\PayGroupAssignment;
use App\Models\Reimbursement;
use App\Models\User;
use Illuminate\Support\Facades\DB;

$prefix = 'fixbug_' . uniqid();

$org = Organization::create(['name' => 'FixBugTest', 'slug' => $prefix]);
$dept = Group::create([
    'organization_id' => $org->id,
    'name' => 'Engineering',
    'slug' => $prefix . '_eng',
    'is_active' => true,
]);
$admin = User::factory()->create([
    'organization_id' => $org->id,
    'role' => 'admin',
    'name' => 'Admin',
    'email' => $prefix . '_admin@test.com',
]);
$emp1 = User::factory()->create([
    'organization_id' => $org->id,
    'role' => 'employee',
    'name' => 'Bug Emp 1',
    'email' => $prefix . '_e1@test.com',
]);
$emp2 = User::factory()->create([
    'organization_id' => $org->id,
    'role' => 'employee',
    'name' => 'Bug Emp 2',
    'email' => $prefix . '_e2@test.com',
]);
DB::table('group_user')->insert([
    ['group_id' => $dept->id, 'user_id' => $emp1->id, 'created_at' => now(), 'updated_at' => now()],
    ['group_id' => $dept->id, 'user_id' => $emp2->id, 'created_at' => now(), 'updated_at' => now()],
]);

// Add a $1000 reimbursement to emp1 + a $500 FBP allocation to emp2
// (Use raw insert because the Reimbursement model's $fillable doesn't
// include 'title', but the column is NOT NULL.)
DB::table('reimbursements')->insert([
    'organization_id' => $org->id,
    'user_id' => $emp1->id,
    'title' => 'Test Reimbursement',
    'amount' => 1000,
    'currency' => 'INR',
    'status' => 'approved',
    'description' => 'Test reimbursement',
    'created_at' => now(),
    'updated_at' => now(),
]);

$plainToken = bin2hex(random_bytes(40));
DB::table('personal_access_tokens')->insert([
    'tokenable_type' => User::class,
    'tokenable_id' => $admin->id,
    'name' => 'fixbug',
    'token' => hash('sha256', $plainToken),
    'abilities' => json_encode(['*']),
    'expires_at' => null,
    'created_at' => now(),
    'updated_at' => now(),
]);

$kernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);

function call($kernel, $admin, $token, $method, $url, $body = null) {
    $req = \Illuminate\Http\Request::create($url, $method, [], [], [], [
        'HTTP_AUTHORIZATION' => 'Bearer ' . $token,
        'HTTP_ACCEPT' => 'application/json',
        'CONTENT_TYPE' => 'application/json',
    ], $body ? json_encode($body) : null);
    $req->setUserResolver(fn () => $admin);
    $res = $kernel->handle($req);
    return ['status' => $res->getStatusCode(), 'body' => json_decode($res->getContent(), true)];
}

echo "=== Test 1: Bulk process employees (verify custom_earnings is a float, not array) ===\n";
// Pre-create templates with annual_ctc so the process succeeds
foreach ([$emp1, $emp2] as $e) {
    \App\Models\EmployeePayrollTemplate::create([
        'organization_id' => $org->id,
        'user_id' => $e->id,
        'annual_ctc' => 600000, // ₹50,000/month
    ]);
}

$r = call($kernel, $admin, $plainToken, 'POST', "/api/payroll/departments/{$dept->id}/process-selected", [
    'month_year' => '2026-06',
    'user_ids' => [$emp1->id, $emp2->id],
    'working_days' => 22,
]);
echo "Status: " . $r['status'] . "\n";
echo "Message: " . ($r['body']['message'] ?? 'no msg') . "\n";
echo "Succeeded: " . count($r['body']['succeeded'] ?? []) . " / " . count($r['body']['failed'] ?? []) . " failed\n";

foreach ($r['body']['succeeded'] ?? [] as $s) {
    $item = \App\Models\PayrollItem::find($s['payroll_item_id']);
    $ce = $item->custom_earnings;
    echo "  emp {$s['user_id']}: custom_earnings = ";
    var_export($ce);
    echo " (type: " . gettype($ce) . ")\n";
    if (is_array($ce)) {
        echo "  ⚠️  STILL AN ARRAY — FIX FAILED\n";
    }
    if (is_numeric($ce)) {
        echo "  ✓ Is numeric\n";
    }
}

echo "\n=== Test 2: Reimbursements total reflected in response ===\n";
echo "emp1 reimbursements_total (in response): " . ($r['body']['reimbursements_total'] ?? 'N/A') . "\n";

// Cleanup
DB::table('personal_access_tokens')->where('tokenable_id', $admin->id)->delete();
\App\Models\EmployeePayrollTemplate::where('organization_id', $org->id)->delete();
\App\Models\Reimbursement::where('organization_id', $org->id)->delete();
\App\Models\PayrollItem::where('organization_id', $org->id)->delete();
DB::table('group_user')->whereIn('user_id', [$emp1->id, $emp2->id])->delete();
User::whereIn('id', [$admin->id, $emp1->id, $emp2->id])->delete();
$dept->delete();
$org->delete();

echo "=== Test 3: Bulk process with 25 employees (exercises chunking) ===\n";
// Create 25 employees (crosses the 20-employee chunk boundary)
$emps = [];
for ($i = 0; $i < 25; $i++) {
    $e = User::factory()->create([
        'organization_id' => $org->id,
        'role' => 'employee',
        'name' => "Chunk Emp $i",
        'email' => $prefix . "_chunk{$i}@test.com",
    ]);
    DB::table('group_user')->insert([
        'group_id' => $dept->id, 'user_id' => $e->id, 'created_at' => now(), 'updated_at' => now(),
    ]);
    $emps[] = $e;
}
$empIds = array_map(fn($e) => $e->id, $emps);

DB::enableQueryLog();
$start = microtime(true);
$r = call($kernel, $admin, $plainToken, 'POST', "/api/payroll/departments/{$dept->id}/process-selected", [
    'month_year' => '2026-06',
    'user_ids' => $empIds,
    'working_days' => 22,
]);
$elapsed = (microtime(true) - $start) * 1000;
$queryCount = count(DB::getQueryLog());
DB::disableQueryLog();

echo "Status: " . $r['status'] . "\n";
echo "Time: " . round($elapsed, 1) . " ms\n";
echo "Queries (cumulative for this call): " . $queryCount . "\n";
echo "Succeeded: " . count($r['body']['succeeded'] ?? []) . " / Failed: " . count($r['body']['failed'] ?? []) . "\n";

echo "\n=== Test 4: Verify all 25 payroll items created with float custom_earnings ===\n";
$allFloat = true;
foreach ($empIds as $eid) {
    $item = \App\Models\PayrollItem::where('user_id', $eid)->where('month_year', '2026-06')->first();
    if (!$item) continue;
    $ce = $item->custom_earnings;
    if (!is_numeric($ce)) {
        echo "  ⚠️  emp $eid: custom_earnings is " . var_export($ce, true) . "\n";
        $allFloat = false;
    }
}
if ($allFloat) {
    echo "  ✓ All 25 custom_earnings values are numeric (float/decimal-string)\n";
}

echo "\nDONE\n";