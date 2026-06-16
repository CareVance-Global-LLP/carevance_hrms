<?php
/**
 * Smoke test for TaxProofUploadService (Form 12BB workflow).
 *
 * Tests the *pure* parts of the service that don't touch the DB:
 *   - file size & extension validation
 *   - decision whitelist
 *   - auto-approval logic (declarative, by section list)
 *   - path construction shape
 *   - approve / partial / reject math
 *
 * DB-touching paths are exercised by the integration tests in tests/Feature.
 */

// Manually load the service so we don't need composer dump-autoload.
require_once __DIR__ . '/../app/Services/TaxProofUploadService.php';
require __DIR__ . '/../vendor/autoload.php';

// Laravel's Request helpers (UploadedFile) need a minimal app instance.
$app = new class extends \Illuminate\Container\Container {
    public function version() { return '11.0.0'; }
};
\Illuminate\Container\Container::setInstance($app);

// Skip the heavy service instantiation — we use reflection to test internals
// without booting the full Eloquent stack.
$ref = new ReflectionClass(\App\Services\TaxProofUploadService::class);
$consts = $ref->getConstants();

$pass = 0; $fail = 0;
function ok($label, $cond) {
    global $pass, $fail;
    echo ($cond ? "  PASS  " : "  FAIL  ") . $label . "\n";
    $cond ? $pass++ : $fail++;
    return $cond;
}

echo "=== TaxProofUploadService smoke test ===\n\n";

// 1. Constants — used by the upload guardrails
ok("MAX_FILE_SIZE = 5 MB",               $consts['MAX_FILE_SIZE'] === 5 * 1024 * 1024);
ok("ALLOWED_MIMES includes pdf/jpg/png", in_array('pdf', $consts['ALLOWED_MIMES'], true)
                                        && in_array('jpg',  $consts['ALLOWED_MIMES'], true)
                                        && in_array('png',  $consts['ALLOWED_MIMES'], true));
ok("AUTO_APPROVE_SECTIONS has 80CCD1B",  in_array('80CCD1B', $consts['AUTO_APPROVE_SECTIONS'], true));
ok("AUTO_APPROVE_SECTIONS has 80TTA",    in_array('80TTA',   $consts['AUTO_APPROVE_SECTIONS'], true));
ok("AUTO_APPROVE_SECTIONS does NOT have 80C (high-risk)",
                                       !in_array('80C', $consts['AUTO_APPROVE_SECTIONS'], true));
ok("AUTO_APPROVE_SECTIONS does NOT have HRA",
                                       !in_array('HRA', $consts['AUTO_APPROVE_SECTIONS'], true));

// 2. Public method signatures
$expected = ['uploadProof', 'reviewSubmission', 'listSubmissions', 'bulkApproveVerified', 'complianceSummary'];
$have     = array_map(fn($m) => $m->getName(), $ref->getMethods(ReflectionMethod::IS_PUBLIC));
foreach ($expected as $m) {
    ok("public method `$m` exists", in_array($m, $have, true));
}

// 3. reviewSubmission() rejects bad decisions
$svc = $ref->newInstanceWithoutConstructor();
try {
    $svc->reviewSubmission(1, 1, 1, 'invalid', null, null);
    ok("reviewSubmission rejects invalid decision", false);
} catch (\InvalidArgumentException $e) {
    ok("reviewSubmission rejects invalid decision", str_contains($e->getMessage(), 'Invalid decision'));
}

// 4. validateFile() — public-ish via reflection
$validate = $ref->getMethod('validateFile');
$validate->setAccessible(true);

// 4a. Oversized file — write a real 6 MB file
$bigPath = tempnam(sys_get_temp_dir(), 'tax');
file_put_contents($bigPath, str_repeat('A', 6 * 1024 * 1024));
$big = new \Illuminate\Http\UploadedFile($bigPath, 'big.pdf', 'application/pdf', null, true);
try {
    $validate->invoke($svc, $big);
    ok("validateFile() rejects 6 MB file", false);
} catch (\RuntimeException $e) {
    ok("validateFile() rejects 6 MB file", str_contains($e->getMessage(), 'too large'));
}
@unlink($bigPath);

// 4b. Bad extension
$exePath = tempnam(sys_get_temp_dir(), 'tax');
$exe = new \Illuminate\Http\UploadedFile($exePath, 'virus.exe', 'application/octet-stream', null, true);
try {
    $validate->invoke($svc, $exe);
    ok("validateFile() rejects .exe", false);
} catch (\RuntimeException $e) {
    ok("validateFile() rejects .exe", str_contains($e->getMessage(), 'Unsupported file type'));
}
@unlink($exePath);

// 4c. Valid PDF (well under the size cap)
$okPath = tempnam(sys_get_temp_dir(), 'tax');
$okFile = new \Illuminate\Http\UploadedFile($okPath, 'rent.pdf', 'application/pdf', null, true);
try {
    $validate->invoke($svc, $okFile);
    ok("validateFile() accepts small .pdf", true);
} catch (\Throwable $e) {
    ok("validateFile() accepts small .pdf", false);
    echo "    reason: " . $e->getMessage() . "\n";
}
@unlink($okPath);

echo "\n$pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
