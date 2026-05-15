@echo off
setlocal EnableDelayedExpansion

echo ============================================================
echo CareVance Error Log Collection - Windows Deployment
echo ============================================================
echo.
echo This script will collect error logs from your AWS Lightsail server.
echo.

REM Configuration
echo Please enter your AWS Lightsail server details:
set /p AWS_HOST="Server IP or Hostname: "
set /p AWS_USER="Username (usually ubuntu): "
set /p AWS_KEY="Path to SSH key (.pem file): "

echo.
echo ============================================================
echo Uploading collection script to server...
echo ============================================================

REM Create the script content
echo #!/bin/bash > "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo. >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "========================================" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "CareVance Error Log Collection" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "========================================" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo. >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "=== PHP Syntax Check ===" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo cd /var/www/carevance/backend ^&^& php -l app/Http/Controllers/Api/ActivityController.php >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo. >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "=== Recent Laravel Errors (last 100 lines) ===" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo tail -100 /var/www/carevance/backend/storage/logs/laravel.log >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo. >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "=== Recent Nginx Errors ===" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo sudo tail -50 /var/log/nginx/error.log >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo. >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "=== PHP-FPM Status ===" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo systemctl status php8.4-fpm --no-pager >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo. >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "=== File Permissions ===" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo ls -la /var/www/carevance/backend/app/Http/Controllers/Api/ActivityController.php >> "D:\CareVance_Hrms_IDE\temp_collect.sh"
echo echo "=== Script Complete ===" >> "D:\CareVance_Hrms_IDE\temp_collect.sh"

REM Upload and run
echo Uploading script...
scp -i "%AWS_KEY%" "D:\CareVance_Hrms_IDE\temp_collect.sh" %AWS_USER%@%AWS_HOST%:/tmp/collect_errors.sh
if errorlevel 1 (
    echo ERROR: Failed to upload script
    pause
    exit /b 1
)

echo.
echo Running script on server...
echo ============================================================
ssh -i "%AWS_KEY%" %AWS_USER%@%AWS_HOST% "chmod +x /tmp/collect_errors.sh && /tmp/collect_errors.sh"
echo ============================================================
echo.

echo Collection complete! 
echo Copy all the output above and paste it to me.
echo.

REM Cleanup
del "D:\CareVance_Hrms_IDE\temp_collect.sh" 2>nul

pause
