@echo off
setlocal EnableDelayedExpansion

echo ============================================================
echo ActivityController.php Deployment Script
echo ============================================================
echo.

REM Configuration - UPDATE THESE VALUES
echo Please enter your AWS Lightsail server details:
set /p AWS_HOST="Server IP or Hostname: "
set /p AWS_USER="Username (usually ubuntu): "
set /p AWS_KEY="Path to SSH key (.pem file): "

echo.
echo ============================================================
echo Step 1: Backing up current file on server
echo ============================================================
ssh -i "%AWS_KEY%" %AWS_USER%@%AWS_HOST% "sudo cp /var/www/carevance/backend/app/Http/Controllers/Api/ActivityController.php /var/www/carevance/backend/app/Http/Controllers/Api/ActivityController.php.backup.%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
if errorlevel 1 (
    echo ERROR: Failed to backup file
    pause
    exit /b 1
)
echo [OK] Backup created

echo.
echo ============================================================
echo Step 2: Uploading corrected ActivityController.php
echo ============================================================
scp -i "%AWS_KEY%" "D:\CareVance_Hrms_IDE\backend\app\Http\Controllers\Api\ActivityController.php" %AWS_USER%@%AWS_HOST%:/tmp/ActivityController.php
if errorlevel 1 (
    echo ERROR: Failed to upload file
    pause
    exit /b 1
)
echo [OK] File uploaded to /tmp/

echo.
echo ============================================================
echo Step 3: Moving file to correct location
echo ============================================================
ssh -i "%AWS_KEY%" %AWS_USER%@%AWS_HOST% "sudo mv /tmp/ActivityController.php /var/www/carevance/backend/app/Http/Controllers/Api/ActivityController.php && sudo chown www-data:www-data /var/www/carevance/backend/app/Http/Controllers/Api/ActivityController.php && sudo chmod 644 /var/www/carevance/backend/app/Http/Controllers/Api/ActivityController.php"
if errorlevel 1 (
    echo ERROR: Failed to move file
    pause
    exit /b 1
)
echo [OK] File moved and permissions set

echo.
echo ============================================================
echo Step 4: Verifying PHP syntax on server
echo ============================================================
ssh -i "%AWS_KEY%" %AWS_USER%@%AWS_HOST% "cd /var/www/carevance/backend && php -l app/Http/Controllers/Api/ActivityController.php"
if errorlevel 1 (
    echo ERROR: Syntax check failed on server
    pause
    exit /b 1
)
echo [OK] Syntax valid

echo.
echo ============================================================
echo Step 5: Clearing caches
echo ============================================================
ssh -i "%AWS_KEY%" %AWS_USER%@%AWS_HOST% "cd /var/www/carevance/backend && sudo -u www-data php artisan cache:clear && sudo -u www-data php artisan config:clear && sudo -u www-data php artisan view:clear"
echo [OK] Caches cleared

echo.
echo ============================================================
echo Step 6: Restarting PHP-FPM and Nginx
echo ============================================================
ssh -i "%AWS_KEY%" %AWS_USER%@%AWS_HOST% "sudo systemctl restart php8.4-fpm && sudo systemctl restart nginx"
echo [OK] Services restarted

echo.
echo ============================================================
echo Deployment Complete!
echo ============================================================
echo.
echo Please test the Activity endpoint now.
echo.
pause
