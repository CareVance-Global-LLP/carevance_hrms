@echo off
setlocal EnableDelayedExpansion

echo ============================================================
echo CareVance Server Fix - Windows Deployment Script
echo ============================================================
echo.
echo This script will:
echo 1. Upload the fixed ActivityFeedService.php
echo 2. Fix storage permissions on server
echo 3. Clear caches and restart services
echo.

REM Configuration
echo Please enter your AWS Lightsail server details:
set /p AWS_HOST="Server IP or Hostname: "
set /p AWS_USER="Username (usually ubuntu): "
set /p AWS_KEY="Path to SSH key (.pem file): "

echo.
echo ============================================================
echo Step 1: Uploading fixed ActivityFeedService.php
echo ============================================================
scp -i "%AWS_KEY%" "D:\CareVance_Hrms_IDE\backend\app\Services\Monitoring\ActivityFeedService.php" %AWS_USER%@%AWS_HOST%:/tmp/ActivityFeedService.php
if errorlevel 1 (
    echo ERROR: Failed to upload ActivityFeedService.php
    pause
    exit /b 1
)
echo [OK] Uploaded to /tmp/

echo.
echo ============================================================
echo Step 2: Moving file and fixing permissions
echo ============================================================
ssh -i "%AWS_KEY%" %AWS_USER%@%AWS_HOST% "sudo mv /tmp/ActivityFeedService.php /var/www/carevance/backend/app/Services/Monitoring/ActivityFeedService.php && sudo chown www-data:www-data /var/www/carevance/backend/app/Services/Monitoring/ActivityFeedService.php && sudo chmod 644 /var/www/carevance/backend/app/Services/Monitoring/ActivityFeedService.php"
if errorlevel 1 (
    echo ERROR: Failed to move file
    pause
    exit /b 1
)
echo [OK] File moved and permissions set

echo.
echo ============================================================
echo Step 3: Running server fix script
echo ============================================================
ssh -i "%AWS_KEY%" %AWS_USER%@%AWS_HOST% "bash -s" < "D:\CareVance_Hrms_IDE\server_fix.sh"
if errorlevel 1 (
    echo ERROR: Server fix script failed
    pause
    exit /b 1
)

echo.
echo ============================================================
echo All fixes applied!
echo ============================================================
echo.
echo Please test your application now.
echo.
pause
