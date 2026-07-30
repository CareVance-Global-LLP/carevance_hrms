<?php
require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();
$results = DB::select("SELECT id, status, month_year FROM payroll_monthly_runs");
echo json_encode($results, JSON_PRETTY_PRINT);