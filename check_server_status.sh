#!/bin/bash

echo "========================================"
echo "CareVance Server Status Check"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd /var/www/carevance/backend

echo -e "${YELLOW}1. Checking PHP Syntax${NC}"
echo "========================================"
echo "ActivityFeedService.php:"
php -l app/Services/Monitoring/ActivityFeedService.php
echo ""
echo "ActivityController.php:"
php -l app/Http/Controllers/Api/ActivityController.php
echo ""

echo -e "${YELLOW}2. Checking Service Status${NC}"
echo "========================================"
echo "PHP-FPM:"
if systemctl is-active --quiet php8.4-fpm; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
fi
echo ""

echo "Nginx:"
if systemctl is-active --quiet nginx; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
fi
echo ""

echo -e "${YELLOW}3. Testing API Endpoint${NC}"
echo "========================================"
echo "Testing: GET /api/activities"
HTTP_CODE=$(curl -s -o /tmp/test_response.json -w "%{http_code}" \
    -H "Accept: application/json" \
    "http://localhost/api/activities?page=1&per_page=5" 2>/dev/null || echo "000")

echo "HTTP Response Code: $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ API responding successfully${NC}"
    echo ""
    echo "Response (first 500 chars):"
    cat /tmp/test_response.json | head -c 500
    echo ""
elif [ "$HTTP_CODE" = "500" ]; then
    echo -e "${RED}✗ Server error (500)${NC}"
    echo ""
    echo "Response:"
    cat /tmp/test_response.json 2>/dev/null || echo "No response body"
    echo ""
elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
    echo -e "${YELLOW}! Authentication required (expected for protected endpoint)${NC}"
    echo -e "${GREEN}✓ Server is responding${NC}"
else
    echo -e "${RED}✗ Unexpected response: $HTTP_CODE${NC}"
fi
echo ""

echo -e "${YELLOW}4. Recent Error Log${NC}"
echo "========================================"
if [ -f storage/logs/laravel.log ]; then
    # Get last 5 error entries
    tail -50 storage/logs/laravel.log | grep -E "(ERROR|CRITICAL|ALERT)" | tail -5
    if [ ${PIPESTATUS[1]} -ne 0 ]; then
        echo "No recent errors found"
    fi
else
    echo "Log file not found"
fi
echo ""

echo -e "${YELLOW}5. Storage Permissions${NC}"
echo "========================================"
ls -la storage/ | head -3
echo ""
echo "Log file writable:"
if [ -w storage/logs/laravel.log ]; then
    echo -e "${GREEN}✓ Yes${NC}"
else
    echo -e "${RED}✗ No${NC}"
fi
echo ""

echo -e "${YELLOW}6. Database Connection${NC}"
echo "========================================"
sudo -u www-data php artisan tinker --execute="echo 'DB connected: ' . (DB::connection()->getPdo() ? 'Yes' : 'No');" 2>&1 | head -2
echo ""

echo "========================================"
echo "Status check complete!"
echo "========================================"
echo ""
echo "If you're still seeing errors, please copy the output above and paste it here."
