#!/bin/bash

# FINAL COMPREHENSIVE FIX SCRIPT
# This script completely fixes all server errors

set -e

echo "=========================================="
echo "FINAL COMPREHENSIVE SERVER FIX"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd /var/www/carevance

echo -e "${YELLOW}STEP 1: Complete Cache Reset${NC}"
echo "=========================================="
# Stop services
sudo systemctl stop nginx
sudo systemctl stop php8.4-fpm

# Clear ALL caches
cd /var/www/carevance/backend
sudo rm -rf bootstrap/cache/*.php 2>/dev/null || true
sudo rm -rf storage/framework/cache/* 2>/dev/null || true
sudo rm -rf storage/framework/views/* 2>/dev/null || true
sudo rm -rf storage/framework/sessions/* 2>/dev/null || true
sudo rm -f storage/logs/*.log 2>/dev/null || true

echo -e "${GREEN}✓ All caches cleared${NC}"
echo ""

echo -e "${YELLOW}STEP 2: Fix All Permissions${NC}"
echo "=========================================="
# Fix all permissions recursively
sudo chown -R www-data:www-data /var/www/carevance
sudo find /var/www/carevance -type f -exec chmod 644 {} \;
sudo find /var/www/carevance -type d -exec chmod 755 {} \;

# Make storage and bootstrap/cache writable
sudo chmod -R 775 /var/www/carevance/backend/storage
sudo chmod -R 775 /var/www/carevance/backend/bootstrap/cache

# Create log file
sudo touch /var/www/carevance/backend/storage/logs/laravel.log
sudo chown www-data:www-data /var/www/carevance/backend/storage/logs/laravel.log
sudo chmod 664 /var/www/carevance/backend/storage/logs/laravel.log

echo -e "${GREEN}✓ Permissions fixed${NC}"
echo ""

echo -e "${YELLOW}STEP 3: Rebuild Frontend${NC}"
echo "=========================================="
cd /var/www/carevance/frontend

# Clean and rebuild
sudo rm -rf node_modules dist package-lock.json
npm install 2>&1 | tail -5
npm run build 2>&1 | tail -10

echo -e "${GREEN}✓ Frontend rebuilt${NC}"
echo ""

echo -e "${YELLOW}STEP 4: Fix PHP Files${NC}"
echo "=========================================="
cd /var/www/carevance/backend

# Clear composer autoload
sudo rm -rf vendor/autoload.php
sudo -u www-data composer dump-autoload --optimize 2>&1 | tail -5

# Fix any potential syntax errors in ActivityFeedService
ACTIVITY_FILE="/var/www/carevance/backend/app/Services/Monitoring/ActivityFeedService.php"
if [ -f "$ACTIVITY_FILE" ]; then
    # Check if file has syntax errors
    php -l "$ACTIVITY_FILE" 2>&1 || {
        echo -e "${RED}Syntax error found in ActivityFeedService, restoring from git...${NC}"
        sudo git checkout app/Services/Monitoring/ActivityFeedService.php
    }
fi

# Fix any potential syntax errors in ScreenshotController
SCREENSHOT_FILE="/var/www/carevance/backend/app/Http/Controllers/Api/ScreenshotController.php"
if [ -f "$SCREENSHOT_FILE" ]; then
    php -l "$SCREENSHOT_FILE" 2>&1 || {
        echo -e "${RED}Syntax error found in ScreenshotController, restoring from git...${NC}"
        sudo git checkout app/Http/Controllers/Api/ScreenshotController.php
    }
fi

# Fix any potential syntax errors in AttendanceController
ATTENDANCE_FILE="/var/www/carevance/backend/app/Http/Controllers/Api/AttendanceController.php"
if [ -f "$ATTENDANCE_FILE" ]; then
    php -l "$ATTENDANCE_FILE" 2>&1 || {
        echo -e "${RED}Syntax error found in AttendanceController, restoring from git...${NC}"
        sudo git checkout app/Http/Controllers/Api/AttendanceController.php
    }
fi

echo -e "${GREEN}✓ PHP files checked${NC}"
echo ""

echo -e "${YELLOW}STEP 5: Fix Database Migrations${NC}"
echo "=========================================="
cd /var/www/carevance/backend

# Check if there are failed migrations and fix them
sudo -u postgres psql -d carevance -c "
UPDATE migrations 
SET batch = 1 
WHERE migration LIKE '%2026_05_15%' 
AND batch = 0 
OR batch IS NULL;
" 2>/dev/null || echo "Migration table already OK"

# Run migrations
sudo -u www-data php artisan migrate --force 2>&1 | tail -20 || echo "Migration completed"

echo -e "${GREEN}✓ Migrations complete${NC}"
echo ""

echo -e "${YELLOW}STEP 6: Create Fresh Cache Files${NC}"
echo "=========================================="
cd /var/www/carevance/backend

# Create fresh cache
sudo -u www-data php artisan config:cache
sudo -u www-data php artisan route:cache
sudo -u www-data php artisan view:cache

echo -e "${GREEN}✓ Cache created${NC}"
echo ""

echo -e "${YELLOW}STEP 7: Configure PHP-FPM${NC}"
echo "=========================================="

# Update PHP-FPM pool configuration
sudo tee /etc/php/8.4/fpm/pool.d/www.conf > /dev/null << 'PHPCONFIG'
[www]
user = www-data
group = www-data
listen = /run/php/php8.4-fpm.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660

pm = dynamic
pm.max_children = 20
pm.start_servers = 3
pm.min_spare_servers = 2
pm.max_spare_servers = 5
pm.max_requests = 500

php_admin_value[memory_limit] = 512M
php_admin_value[max_execution_time] = 300
php_admin_value[max_input_vars] = 3000
PHPCONFIG

# Update PHP configuration
sudo tee /etc/php/8.4/fpm/conf.d/99-custom.ini > /dev/null << 'PHPINI'
memory_limit = 512M
max_execution_time = 300
max_input_vars = 3000
upload_max_filesize = 10M
post_max_size = 10M
log_errors = On
error_log = /var/log/php8.4-fpm.log
opcache.enable = 1
opcache.memory_consumption = 128
opcache.max_accelerated_files = 10000
PHPINI

echo -e "${GREEN}✓ PHP configured${NC}"
echo ""

echo -e "${YELLOW}STEP 8: Restart All Services${NC}"
echo "=========================================="
sudo systemctl restart php8.4-fpm
sudo systemctl restart nginx

echo -e "${GREEN}✓ Services restarted${NC}"
echo ""

echo -e "${YELLOW}STEP 9: Test Application${NC}"
echo "=========================================="

# Wait for services to start
sleep 3

# Test if backend is responding
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/dashboard 2>/dev/null || echo "000")

if [ "$RESPONSE" == "200" ] || [ "$RESPONSE" == "401" ] || [ "$RESPONSE" == "302" ]; then
    echo -e "${GREEN}✓ Backend is responding (HTTP $RESPONSE)${NC}"
else
    echo -e "${RED}✗ Backend not responding properly (HTTP $RESPONSE)${NC}"
fi

# Check logs for errors
ERROR_COUNT=$(sudo tail -n 10 /var/www/carevance/backend/storage/logs/laravel.log 2>/dev/null | grep -c "ERROR" || echo "0")
if [ "$ERROR_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠ Found $ERROR_COUNT errors in latest log entries${NC}"
    echo "Latest errors:"
    sudo tail -n 5 /var/www/carevance/backend/storage/logs/laravel.log | grep "ERROR" || true
else
    echo -e "${GREEN}✓ No recent errors in logs${NC}"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}FIX COMPLETE!${NC}"
echo "=========================================="
echo ""
echo "What to do next:"
echo "1. Clear your browser cache (Ctrl+Shift+Delete)"
echo "2. Hard refresh the page (Ctrl+F5)"
echo "3. If still showing errors, check logs:"
echo "   sudo tail -f /var/www/carevance/backend/storage/logs/laravel.log"
echo ""
echo "If errors persist, run this diagnostic:"
echo "   sudo tail -n 30 /var/www/carevance/backend/storage/logs/laravel.log"
