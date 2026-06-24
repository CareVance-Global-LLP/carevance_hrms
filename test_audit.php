<?php
require 'D:\CareVance_Hrms_IDE\backend\vendor/autoload.php';
$app = require_once 'D:\CareVance_Hrms_IDE\backend\bootstrap/app.php';
$app->make('Illuminate\Contracts\Console\Kernel')->bootstrap();

try {
    // Try to create an audit log entry
    $app->make(\App\Services\Audit\AuditLogService::class)->log(
        'test_action',
        null, // actor
        null, // target
        ['test' => 'data'],
        null, // request
        1 // organizationId
    );
    echo "Audit log created successfully\n";
} catch (\Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
    echo "File: " . $e->getFile() . "\n";
    echo "Line: " . $e->getLine() . "\n";
    echo "Trace: " . $e->getTraceAsString() . "\n";
}
?>