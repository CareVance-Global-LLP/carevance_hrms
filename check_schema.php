<?php
require 'D:\CareVance_Hrms_IDE\backend\vendor/autoload.php';
$app = require_once 'D:\CareVance_Hrms_IDE\backend\bootstrap/app.php';
$app->make('Illuminate\Contracts\Console\Kernel')->bootstrap();
$columns = Illuminate\Support\Facades\DB::getSchemaBuilder()->getColumnListing('audit_logs');
print_r($columns);
?>