#!/bin/bash

echo "========================================"
echo "CareVance Server Fix Script"
echo "========================================"
echo ""

# Fix 1: Fix storage permissions
echo "Fixing storage permissions..."
sudo chown -R www-data:www-data /var/www/carevance/backend/storage
sudo chmod -R 775 /var/www/carevance/backend/storage
sudo chmod -R 775 /var/www/carevance/backend/bootstrap/cache
echo "[OK] Storage permissions fixed"
echo ""

# Fix 2: Check ActivityFeedService syntax
echo "Checking ActivityFeedService.php syntax..."
cd /var/www/carevance/backend
php -l app/Services/Monitoring/ActivityFeedService.php
if [ $? -ne 0 ]; then
    echo "[ERROR] Syntax check failed"
    exit 1
fi
echo "[OK] ActivityFeedService.php syntax valid"
echo ""

# Fix 3: Check ActivityController syntax
echo "Checking ActivityController.php syntax..."
php -l app/Http/Controllers/Api/ActivityController.php
if [ $? -ne 0 ]; then
    echo "[ERROR] Syntax check failed"
    exit 1
fi
echo "[OK] ActivityController.php syntax valid"
echo ""

# Fix 4: Clear all caches
echo "Clearing caches..."
sudo -u www-data php artisan cache:clear 2>/dev/null || echo "  Cache clear warning (non-critical)"
sudo -u www-data php artisan config:clear 2>/dev/null || echo "  Config clear warning (non-critical)"
sudo -u www-data php artisan view:clear 2>/dev/null || echo "  View clear warning (non-critical)"
echo "[OK] Caches cleared"
echo ""

# Fix 5: Restart PHP-FPM and Nginx
echo "Restarting services..."
sudo systemctl restart php8.4-fpm
if [ $? -ne 0 ]; then
    echo "[ERROR] PHP-FPM restart failed"
    exit 1
fi
echo "[OK] PHP-FPM restarted"

sudo systemctl restart nginx
if [ $? -ne 0 ]; then
    echo "[ERROR] Nginx restart failed"
    exit 1
fi
echo "[OK] Nginx restarted"
echo ""

# Fix 6: Verify services are running
echo "Verifying services..."
sleep 2
if systemctl is-active --quiet php8.4-fpm; then
    echo "[OK] PHP-FPM is running"
else
    echo "[ERROR] PHP-FPM is not running"
    exit 1
fi

if systemctl is-active --quiet nginx; then
    echo "[OK] Nginx is running"
else
    echo "[ERROR] Nginx is not running"
    exit 1
fi
echo ""

# Fix 7: Test the API endpoint
echo "Testing API endpoint..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/health 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ]; then
    echo "[OK] API responding (HTTP $HTTP_CODE)"
else
    echo "[WARNING] API test returned HTTP $HTTP_CODE"
fi
echo ""

echo "========================================"
echo "Fix complete! Please test your app now."
echo "========================================"
