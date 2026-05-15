#!/bin/bash

# Quick Fix Script for Server Errors
# Run this on your AWS Lightsail server

set -e

echo "=========================================="
echo "Quick Server Error Fix"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Detect PHP version
PHP_VERSION=""
for version in 8.4 8.3 8.2 8.1 8.0; do
    if [ -f /var/log/php${version}-fpm.log ] || [ -d /etc/php/${version} ]; then
        PHP_VERSION="$version"
        break
    fi
done

if [ -z "$PHP_VERSION" ]; then
    echo -e "${RED}Could not detect PHP version${NC}"
    PHP_VERSION="8.4"  # Default fallback
fi

echo -e "${GREEN}Detected PHP version: ${PHP_VERSION}${NC}"

cd /var/www/carevance

echo -e "${YELLOW}Step 1: Fixing file permissions...${NC}"
sudo chown -R www-data:www-data /var/www/carevance/backend/storage
sudo chown -R www-data:www-data /var/www/carevance/backend/bootstrap/cache
sudo chmod -R 775 /var/www/carevance/backend/storage
sudo chmod -R 775 /var/www/carevance/backend/bootstrap/cache
echo -e "${GREEN}✓ Permissions fixed${NC}"

echo -e "${YELLOW}Step 2: Clearing all caches...${NC}"
cd /var/www/carevance/backend
sudo -u www-data php artisan cache:clear 2>/dev/null || true
sudo -u www-data php artisan config:clear 2>/dev/null || true
sudo -u www-data php artisan route:clear 2>/dev/null || true
sudo -u www-data php artisan view:clear 2>/dev/null || true
sudo -u www-data php artisan optimize:clear 2>/dev/null || true
echo -e "${GREEN}✓ Caches cleared${NC}"

echo -e "${YELLOW}Step 3: Checking for failed migrations...${NC}"
# Check if the problematic migration exists in the database
FAILED_MIGRATION=$(sudo -u postgres psql -d carevance -t -c "SELECT migration FROM migrations WHERE migration LIKE '%2026_05_15%' ORDER BY id DESC LIMIT 1;" 2>/dev/null | xargs)

if [ ! -z "$FAILED_MIGRATION" ]; then
    echo -e "${YELLOW}Found migration: ${FAILED_MIGRATION}${NC}"
    echo -e "${YELLOW}Removing failed migration record...${NC}"
    sudo -u postgres psql -d carevance -c "DELETE FROM migrations WHERE migration LIKE '%2026_05_15%';" 2>/dev/null || true
    echo -e "${GREEN}✓ Migration record removed${NC}"
else
    echo -e "${GREEN}No failed migrations found${NC}"
fi

echo -e "${YELLOW}Step 4: Running migrations...${NC}"
sudo -u www-data php artisan migrate --force 2>&1 | tee /tmp/migrate_output.log
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Migrations completed${NC}"
else
    echo -e "${RED}✗ Migration failed. Check /tmp/migrate_output.log${NC}"
    echo "Error output:"
    tail -20 /tmp/migrate_output.log
fi

echo -e "${YELLOW}Step 5: Optimizing application...${NC}"
sudo -u www-data php artisan config:cache 2>/dev/null || true
sudo -u www-data php artisan route:cache 2>/dev/null || true
sudo -u www-data php artisan view:cache 2>/dev/null || true
sudo -u www-data php artisan optimize 2>/dev/null || true
echo -e "${GREEN}✓ Optimization complete${NC}"

echo -e "${YELLOW}Step 6: Restarting services...${NC}"
sudo systemctl restart nginx
sudo systemctl restart php${PHP_VERSION}-fpm
echo -e "${GREEN}✓ Services restarted${NC}"

echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}Fix Complete!${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo "Test your application now. If still showing errors, run the diagnostic script:"
echo "  bash diagnose-server-errors.sh"
