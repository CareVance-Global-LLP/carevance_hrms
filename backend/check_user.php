<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$user = App\Models\User::where('email', 'ayushborwal004@gmail.com')->first();
if ($user) {
    echo "User found: " . $user->email . "\n";
    echo "Password hash: " . $user->password . "\n";
    echo "Hash check: " . (Hash::check('12345678', $user->password) ? "MATCH" : "NO MATCH") . "\n";
    echo "Email verified: " . ($user->email_verified_at ? "YES" : "NO") . "\n";
} else {
    echo "User not found\n";
}
