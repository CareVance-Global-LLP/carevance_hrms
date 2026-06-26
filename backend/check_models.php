<?php
$files = [
  'app/Services/PayrollApprovalService.php',
  'app/Services/PayrollBurnRateService.php',
  'app/Services/ProductivityPayrollService.php',
  'app/Services/OffCyclePayrollService.php',
  'app/Models/Payroll.php',
  'app/Models/PayRunApproval.php',
  'app/Models/PayrollMonthlyRun.php',
];

$missing = [];
foreach ($files as $f) {
    if (!file_exists($f)) { $missing[] = "$f NOT FOUND"; continue; }
    $src = file_get_contents($f);
    preg_match_all('#use App\\\\Models\\\\([^;]+);#', $src, $m);
    foreach ($m[1] as $class) {
        $path = 'app/Models/' . $class . '.php';
        if (!file_exists($path)) {
            $missing[] = "$class (referenced in $f)";
        }
    }
}

if ($missing) {
    echo "STILL MISSING MODELS:\n";
    foreach ($missing as $m) echo "  - $m\n";
    exit(1);
} else {
    echo "ALL MODEL REFERENCES RESOLVE OK\n";
}
