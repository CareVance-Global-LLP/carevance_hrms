<?php

require __DIR__ . '/vendor/autoload.php';
$app = require __DIR__ . '/bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Carbon\Carbon;

$now = Carbon::now();
$start = $now->copy()->startOfMonth();
$stale = $start->copy()->addDays(5);

echo "now: " . $now->toDateTimeString() . "\n";
echo "start: " . $start->toDateTimeString() . "\n";
echo "stale: " . $stale->toDateTimeString() . "\n";
$boundary = max($start, $now->copy()->startOfDay());
echo "boundary: " . $boundary->toDateTimeString() . "\n";
echo "stale < boundary: " . ($stale->lt($boundary) ? 'YES' : 'NO') . "\n";
