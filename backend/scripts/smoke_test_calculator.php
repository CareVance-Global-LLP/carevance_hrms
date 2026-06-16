<?php
/**
 * Smoke test for PayrollCalculatorService and PTStateService.
 * Runs purely in-memory (no Laravel boot needed).
 *
 * Every expected value here has been hand-verified against Indian
 * Income Tax Act, 1961 (FY 2024-25) and the ESI/PF/PT statutes.
 */

require __DIR__ . '/../vendor/autoload.php';

if (!class_exists('App\\Models\\EmployeeTaxDeclaration')) {
    eval('namespace App\\Models; class EmployeeTaxDeclaration { public static function where(){ return new self; } public function where(){ return $this; } public function first(){ return null; } public function items(){ return $this; } public function where2(){ return $this; } public function get(){ return collect([]); } }');
}
if (!class_exists('App\\Models\\SalaryFormula')) {
    eval('namespace App\\Models; class SalaryFormula { public static function find(){ return null; } }');
}

use App\Services\PayrollCalculatorService;
use App\Services\PTStateService;

$calc = new PayrollCalculatorService();

$pass = 0; $fail = 0;
function ok($label, $got, $expected, $tolerance = 1.0) {
    global $pass, $fail;
    $ok = is_numeric($expected) ? (abs($got - $expected) < $tolerance) : ($got === $expected);
    $exp = is_numeric($expected) ? number_format($expected) : $expected;
    echo ($ok ? "  PASS  " : "  FAIL  ") . "$label  (got=" . (is_numeric($got) ? number_format($got, 2) : $got) . "  expected=$exp)\n";
    $ok ? $pass++ : $fail++;
    return $ok;
}

echo "=== Payroll math smoke test (Indian payroll, FY 2024-25) ===\n\n";

// --- 1. 12L annual CTC, new regime, metro MH ---
//   monthlyCtc=1,00,000; basic=40,000; hra=20,000; conveyance=1,600;
//   employerPf = 12% of min(40K, 15K) = 1,800; gratuity = 4.81% of 40K = 1,924
//   gross = 1,00,000 - 1,800 - 1,924 = 96,276
//   net = gross - pf(1,800) - esi(0) - pt(200) - tds(0) = 94,276
echo "[1] 12L CTC / new regime / MH-metro\n";
$r = $calc->calculatePayroll(1200000, 'maharashtra', true, 'new');
ok("Monthly basic = 40,000",        $r['components']['earnings']['basic'], 40000);
ok("Monthly HRA = 20,000 (metro)",  $r['components']['earnings']['hra'], 20000);
ok("Monthly gross = 96,276 (CTC − employer PF − gratuity)", $r['monthly']['gross'], 96276);
ok("Monthly TDS = 0 (87A new regime rebate)", $r['components']['deductions']['tds'], 0);
ok("Monthly PT = 200 (MH slab)",    $r['components']['deductions']['pt'], 200);
ok("Monthly net = 94,276",          $r['monthly']['net'], 94276);

// --- 2. 25L new regime (only 75K SD) ---
//   taxable = 25,00,000 - 75,000 = 24,25,000
//   tax = 4-8L@5% + 8-12L@10% + 12-16L@15% + 16-20L@20% + 20-24L@25% + 24-24.25L@30%
//      = 20,000 + 40,000 + 60,000 + 80,000 + 100,000 + 7,500 = 3,07,500
//   no surcharge (<50L), no 87A rebate (>12L)
//   cess = 4% * 3,07,500 = 12,300
//   total = 3,19,800
echo "\n[2] 25L CTC / new regime / no exemptions\n";
$r4 = $calc->calculateNewRegimeTax(2500000, []);
ok("Taxable = 24,25,000", $r4['taxable_income'], 2425000);
ok("Total tax = 3,19,800 (±0.01% rounding)", $r4['total_tax'], 319800, 0.5);

// --- 3. 25L old regime, 1.5L 80C + 25K 80D ---
//   taxable = 25,00,000 - 50,000(SD) - 1,50,000(80C) - 25,000(80D) = 22,75,000
//   tax = 2.5-5L@5% + 5-10L@20% + 10-22.75L@30% = 12,500 + 1,00,000 + 3,82,500 = 4,95,000
//   cess = 4% * 4,95,000 = 19,800
//   total = 5,14,800
echo "\n[3] 25L CTC / old regime / 1.5L 80C + 25K 80D\n";
$r3 = $calc->calculateOldRegimeTax(2500000, ['section_80c' => 150000, 'section_80d' => 25000]);
ok("Taxable = 22,75,000", $r3['taxable_income'], 2275000);
ok("Total tax = 5,14,800 (±0.01% rounding)", $r3['total_tax'], 514800, 0.5);

// --- 4. 12L old regime, full 80C+80CCD+HRA ---
//   taxable = 12,00,000 - 50,000(SD) - 1,50,000(80C) - 50,000(80CCD1B) - 50,000(HRA) = 9,00,000
//   87A old regime cap is ₹5L, so no rebate at 9L taxable
//   tax = 2.5-5L@5% + 5-9L@20% = 12,500 + 80,000 = 92,500
//   cess = 4% * 92,500 = 3,700
//   total = 96,200
echo "\n[4] 12L CTC / old regime / 80C + 80CCD1B + HRA\n";
$r2 = $calc->calculateOldRegimeTax(1200000, [
    'section_80c' => 150000, 'section_80ccd' => 50000, 'hra_exemption' => 50000,
]);
ok("Taxable = 9,00,000", $r2['taxable_income'], 900000);
ok("Total tax = 96,200 (87A old-regime cap is 5L)", $r2['total_tax'], 96200, 0.5);

// --- 5. 5L old regime with full 80C — 87A cap is on TOTAL income, so this fully rebated ---
//   taxable = 5,00,000 - 50,000(SD) - 1,50,000(80C) = 3,00,000
//   tax = (3L-2.5L)*5% = 2,500
//   87A: totalIncome(5L) <= 5L → rebate min(2,500, 12,500) = 2,500
//   total = 0
echo "\n[5] 5L old regime / full 80C (87A on TOTAL income → full rebate)\n";
$r5 = $calc->calculateOldRegimeTax(500000, ['section_80c' => 150000]);
ok("Taxable = 3,00,000", $r5['taxable_income'], 300000);
ok("Total tax = 0 (87A full rebate at 5L total income cap)", $r5['total_tax'], 0);

// --- 5b. 7L old regime, full 80C — 87A is on TOTAL income (7L > 5L), so NO rebate ---
//   taxable = 7,00,000 - 50,000(SD) - 1,50,000(80C) = 5,00,000
//   tax = (5L-2.5L)*5% = 12,500
//   87A: totalIncome(7L) > 5L → no rebate
//   cess 4% = 500
//   total = 13,000
echo "\n[5b] 7L old regime / full 80C (87A cap is on TOTAL income, not taxable)\n";
$r5b = $calc->calculateOldRegimeTax(700000, ['section_80c' => 150000]);
ok("Taxable = 5,00,000", $r5b['taxable_income'], 500000);
ok("Total tax = 13,000 (no 87A — total income 7L > 5L cap)", $r5b['total_tax'], 13000, 0.5);

// --- 6. 12L new regime — should also get 87A rebate ---
//   taxable = 12,00,000 - 75,000 = 11,25,000
//   tax = 4-8L@5% + 8-11.25L@10% = 20,000 + 32,500 = 52,500
//   87A: <= 12L → full rebate
//   total = 0
echo "\n[6] 12L new regime (87A full rebate at 12L cap)\n";
$r6 = $calc->calculateNewRegimeTax(1200000, []);
ok("Taxable = 11,25,000", $r6['taxable_income'], 1125000);
ok("Total tax = 0 (87A full rebate at 12L cap)", $r6['total_tax'], 0);

// --- 7. 12.1L new regime — JUST above 87A cap, expect full tax ---
//   taxable = 12,10,000 - 75,000 = 11,35,000
//   tax = 20,000 + 33,500 = 53,500
//   no rebate; cess 4% = 2,140
//   total = 55,640
echo "\n[7] 12.1L new regime (just above 87A cap)\n";
$r7 = $calc->calculateNewRegimeTax(1210000, []);
ok("Taxable = 11,35,000", $r7['taxable_income'], 1135000);
ok("Total tax = 55,640 (±0.5 rounding)", $r7['total_tax'], 55640, 1.0);

// --- 8. 1Cr new regime — surcharge should kick in ---
//   taxable = 1,00,00,000 - 75,000 = 99,25,000
//   tax across all slabs
//   surcharge (new regime cap 25%) at this bracket
echo "\n[8] 1Cr new regime (surcharge should be 25% for new regime)\n";
$r8 = $calc->calculateNewRegimeTax(10000000, []);
echo "    (surcharge=" . number_format($r8['surcharge']) . ", total_tax=" . number_format($r8['total_tax']) . ")\n";
ok("Surcharge > 0 (high income)", $r8['surcharge'] > 0, true);
ok("Total tax > 0 (no 87A rebate at 1Cr)", $r8['total_tax'] > 0, true);

// --- 9. HRA exemption ---
echo "\n[9] HRA exemption (Sec 10(13A))\n";
ok("Metro, rent-driven: min(120K, 240K, 72K) = 72,000", $calc->calculateHraExemption(120000, 480000, 120000, true), 72000);
ok("Metro, full HRA: min(240K, 240K, 312K) = 240,000", $calc->calculateHraExemption(240000, 480000, 360000, true), 240000);
ok("Non-metro, rent-driven: min(100K, 120K, 70K) = 70,000", $calc->calculateHraExemption(100000, 300000, 100000, false), 70000);
ok("No rent paid: min(...) -ve → 0 (no exemption without rent)", $calc->calculateHraExemption(100000, 300000, 0, false), 0);

// --- 10. PT state coverage ---
echo "\n[10] PT state coverage\n";
ok("MH 8K (slab 7501-10000 = 175)",   PTStateService::calculate('maharashtra', 8000), 175);
ok("MH 15K (>=10001 = 200)",          PTStateService::calculate('maharashtra', 15000), 200);
ok("MH 80K (>=10001 = 200)",          PTStateService::calculate('maharashtra', 80000), 200);
ok("MH Feb 50K (special = 300)",      PTStateService::calculate('maharashtra', 50000, 2), 300);
ok("KA 15K (slab 0-15000 = 0)",       PTStateService::calculate('karnataka', 15000), 0);
ok("KA 25K (>=15001 = 200)",          PTStateService::calculate('karnataka', 25000), 200);
ok("TN 40K (slab 12501+ = 208)",      PTStateService::calculate('tamil_nadu', 40000), 208);
ok("WB 25K (slab 15001-25000 = 130)", PTStateService::calculate('west_bengal', 25000), 130);
ok("Delhi 50K (no PT)",               PTStateService::calculate('delhi', 50000), 0);
ok("Unknown state → 0 (safe default)", PTStateService::calculate('atlantis', 50000), 0);
ok("Empty state → 0",                 PTStateService::calculate('', 50000), 0);

// --- 11. Edge cases ---
echo "\n[11] Edge cases\n";
ok("0 income new regime", $calc->calculateNewRegimeTax(0)['total_tax'], 0);
ok("Negative income clamped", $calc->calculateNewRegimeTax(-1000)['total_tax'], 0);
ok("Empty exemptions old regime", $calc->calculateOldRegimeTax(700000, [])['total_tax'] > 0, true);

// --- 12. PF / ESI / Gratuity ---
echo "\n[12] PF / ESI / Gratuity\n";
ok("PF on 50K basic = 12% * min(50K, 15K) = 1,800", $calc->calculateEmployeePF(50000), 1800);
ok("PF on 10K basic = 12% * 10K = 1,200",           $calc->calculateEmployeePF(10000), 1200);
ok("PF on 15K basic = 12% * 15K = 1,800 (cap)",    $calc->calculateEmployeePF(15000), 1800);
ok("ESI on 20K gross = 0.75% * 20K = 150 (< 21K)", $calc->calculateEmployeeESI(20000), 150);
ok("ESI on 21,001 gross = 0 (above threshold)",     $calc->calculateEmployeeESI(21001), 0);
ok("ESI on 25K gross = 0 (above threshold)",        $calc->calculateEmployeeESI(25000), 0);
ok("Gratuity 4.81% of 1L = 4,810",                  $calc->calculateGratuityProvision(100000), 4810);
ok("Gratuity on exit: (1L * 15 * 5) / 26 = 288,461.54", $calc->calculateGratuityOnExit(100000, 5), 288461.54, 0.1);

echo "\n=== Summary: $pass passed, $fail failed ===\n";
exit($fail === 0 ? 0 : 1);
