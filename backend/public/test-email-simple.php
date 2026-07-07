<?php

// Simple email test script - Memory efficient version
// Run this in your browser: http://localhost:8000/test-email-simple

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "<h1>Email Diagnostic Test</h1>";

try {
    // Test 1: Check mail configuration
    echo "<h2>1. Mail Configuration</h2>";
    echo "MAIL_MAILER: " . config('mail.default') . "<br>";
    echo "QUEUE_CONNECTION: " . config('queue.default') . "<br>";
    echo "App Environment: " . app()->environment() . "<br>";
    
    // Test 2: Send a simple test email
    echo "<h2>2. Sending Test Email</h2>";
    \Illuminate\Support\Facades\Mail::raw('This is a test email sent at ' . now(), function ($message) {
        $message->to('test@example.com')
                ->subject('Test Email');
    });
    
    echo "✅ Email sent successfully!<br>";
    echo "Check your log file: storage/logs/laravel.log<br>";
    
    // Test 3: Check log for recent email - memory efficient
    echo "<h2>3. Recent Log Entries</h2>";
    $logFile = storage_path('logs/laravel.log');
    if (file_exists($logFile)) {
        // Use file_get_contents for small files, limit to last 5KB
        $size = filesize($logFile);
        if ($size > 0) {
            $handle = fopen($logFile, 'r');
            fseek($handle, max(0, $size - 5000)); // Read last 5KB
            $content = fread($handle, 5000);
            fclose($handle);
            
            echo "<pre>" . htmlspecialchars($content) . "</pre>";
        } else {
            echo "Log file is empty.<br>";
        }
    }
    
} catch (\Exception $e) {
    echo "<h2>❌ Error</h2>";
    echo "Message: " . $e->getMessage() . "<br>";
    echo "File: " . $e->getFile() . ":" . $e->getLine() . "<br>";
}

echo "<hr><p>Test completed at " . now() . "</p>";