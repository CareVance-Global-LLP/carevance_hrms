#!/bin/bash

# Server Error Diagnostic Script
# Run this on your AWS Lightsail server to diagnose server errors

echo "=========================================="
echo "SERVER ERROR DIAGNOSTIC"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}1. Checking Laravel Error Logs (last 50 lines)...${NC}"
echo "=========================================="
if [ -f /var/www/carevance/backend/storage/logs/laravel.log ]; then
    sudo tail -n 50 /var/www/carevance/backend/storage/logs/laravel.log
else
    echo "Laravel log file not found"
fi
echo ""

echo -e "${YELLOW}2. Checking Nginx Error Logs (last 30 lines)...${NC}"
echo "=========================================="
if [ -f /var/log/nginx/error.log ]; then
    sudo tail -n 30 /var/log/nginx/error.log
else
    echo "Nginx error log not found"
fi
echo ""

echo -e "${YELLOW}3. Checking PHP-FPM Logs...${NC}"
echo "=========================================="
# Try different PHP versions
for version in 8.4 8.3 8.2 8.1 8.0; do
    if [ -f /var/log/php${version}-fpm.log ]; then
        echo "Found PHP ${version} FPM logs:"
        sudo tail -n 30 /var/log/php${version}-fpm.log
        break
    fi
done
echo ""

echo -e "${YELLOW}4. Checking System Logs for PHP/Nginx errors...${NC}"
echo "=========================================="
sudo journalctl -u nginx --since "1 hour ago" --no-pager -n 20 2>/dev/null || echo "Journalctl not available"
sudo journalctl -u php* --since "1 hour ago" --no-pager -n 20 2>/dev/null || echo "PHP journal not available"
echo ""

echo -e "${YELLOW}5. Checking Laravel Migrations Status...${NC}"
echo "=========================================="
cd /var/www/carevance/backend
sudo -u www-data php artisan migrate:status 2>&1 | head -30
echo ""

echo -e "${YELLOW}6. Checking Database Connection...${NC}"
echo "=========================================="
sudo -u www-data php artisan db:monitor 2>&1 || echo "DB check failed"
echo ""

echo -e "${YELLOW}7. Checking File Permissions...${NC}"
echo "=========================================="
echo "Storage directory permissions:"
ls -la /var/www/carevance/backend/storage/ | head -10
echo ""
echo "Bootstrap cache permissions:"
ls -la /var/www/carevance/backend/bootstrap/cache/ | head -10
echo ""

echo -e "${YELLOW}8. Checking Recent Failed Migrations...${NC}"
echo "=========================================="
sudo -u postgres psql -d carevance -c "SELECT migration, batch FROM migrations WHERE migration LIKE '%2026_05_15%' ORDER BY id DESC;" 2>/dev/null || echo "Could not query database"
echo ""

echo -e "${YELLOW}9. Testing API Endpoints...${NC}"
echo "=========================================="
echo "Testing dashboard endpoint:"
curl -s -o /dev/null -w "%{http_code}" http://localhost/api/dashboard 2>/dev/null || echo "Failed to test"
echo ""

echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}Diagnostic Complete${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo "If you see database migration errors above, run:"
echo "  cd /var/www/carevance/backend"
echo "  sudo -u www-data php artisan migrate:status"
echo "  sudo -u www-data php artisan migrate --force"
echo ""
echo "To fix permission issues:"
echo "  sudo chown -R www-data:www-data /var/www/carevance/backend/storage"
echo "  sudo chown -R www-data:www-data /var/www/carevance/backend/bootstrap/cache"
echo "  sudo chmod -R 775 /var/www/carevance/backend/storage"
echo "  sudo chmod -R 775 /var/www/carevance/backend/bootstrap/cache"
