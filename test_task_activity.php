<?php
require 'D:\CareVance_Hrms_IDE\backend\vendor/autoload.php';
$app = require_once 'D:\CareVance_Hrms_IDE\backend\bootstrap/app.php';
$app->make('Illuminate\Contracts\Console\Kernel')->bootstrap();

try {
    // Get a user and task to test with
    $user = \App\Models\User::first();
    $task = \App\Models\Task::first();
    
    if (!$user || !$task) {
        echo "No user or task found for testing\n";
        exit;
    }
    
    // Try to create a task activity
    $app->make(\App\Services\Tasks\TaskActivityService::class)->logCreated($task, $user);
    echo "Task activity created successfully\n";
} catch (\Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
    echo "File: " . $e->getFile() . "\n";
    echo "Line: " . $e->getLine() . "\n";
    // Don't print trace for now to keep output clean
}
?>