<?php
require './vendor/autoload.php';
$app = require_once './bootstrap/app.php';
$app->make('Illuminate\Contracts\Console\Kernel')->bootstrap();
$columns = Illuminate\Support\Facades\DB::getSchemaBuilder()->getColumnListing('audit_logs');
print_r($columns);
?>