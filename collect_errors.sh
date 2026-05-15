#!/bin/bash

echo "========================================"
echo "CareVance Error Log Collection Script"
echo "========================================"
echo ""

# Define colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Checking ActivityController.php syntax...${NC}"
php -l /var/www/carevance/backend/app/Http/Controllers/Api/ActivityController.php
echo ""

echo -e "${YELLOW}Recent Laravel errors (last 50 lines):${NC}"
echo "========================================"
tail -50 /var/www/carevance/backend/storage/logs/laravel.log 2>/dev/null || echo "Log file not accessible"
echo ""
echo "========================================"
echo ""

echo -e "${YELLOW}Recent Nginx errors:${NC}"
echo "========================================"
sudo tail -30 /var/log/nginx/error.log 2>/dev/null || echo "Nginx log not accessible"
echo ""
echo "========================================"
echo ""

echo -e "${YELLOW}Recent PHP-FPM errors:${NC}"
echo "========================================"
sudo tail -30 /var/log/php8.4-fpm.log 2>/dev/null || sudo tail -30 /var/log/php-fpm.log 2>/dev/null || echo "PHP-FPM log not accessible"
echo ""
echo "========================================"
echo ""

echo -e "${YELLOW}Checking file permissions:${NC}"
echo "ActivityController permissions:"
ls -la /var/www/carevance/backend/app/Http/Controllers/Api/ActivityController.php
echo ""
echo "Storage directory permissions:"
ls -la /var/www/carevance/backend/storage/ | head -5
echo ""
echo "========================================"
echo ""

echo -e "${YELLOW}Checking if all required files exist:${NC}"
echo "ActivityController: $(test -f /var/www/carevance/backend/app/Http/Controllers/Api/ActivityController.php && echo -e "${GREEN}EXISTS${NC}" || echo -e "${RED}MISSING${NC}")"
echo "ActivityFeedService: $(test -f /var/www/carevance/backend/app/Services/Monitoring/ActivityFeedService.php && echo -e "${GREEN}EXISTS${NC}" || echo -e "${RED}MISSING${NC}")"
echo ""

echo -e "${YELLOW}Service status:${NC}"
echo "PHP-FPM: $(systemctl is-active php8.4-fpm 2>/dev/null || echo 'unknown')"
echo "Nginx: $(systemctl is-active nginx 2>/dev/null || echo 'unknown')"
echo ""
echo "========================================"
echo "Script complete! Copy all output above and paste it here."
echo "========================================"
