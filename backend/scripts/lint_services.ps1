Get-ChildItem 'd:\CareVance_Hrms_IDE\backend\app\Services\*.php' | ForEach-Object {
    $name = $_.Name
    $output = & php -l $_.FullName 2>&1
    Write-Host "--- $name ---"
    Write-Host $output
}
