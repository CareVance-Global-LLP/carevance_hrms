#!/bin/bash

# Emergency Fix Script for CareVance Server Errors
# This script applies all the fixes for Monitoring, Screenshot, Attendance Report, Timesheet, Timeline, and Web/App Usage errors

set -e

echo "=========================================="
echo "CareVance Emergency Fix Script"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

DEPLOY_DIR="${DEPLOY_DIR:-$HOME/carevance}"
COMPOSE_FILE="docker-compose.production.yml"

cd "$DEPLOY_DIR"

echo -e "${YELLOW}Step 1: Stopping services...${NC}"
docker-compose -f "$COMPOSE_FILE" down

echo -e "${YELLOW}Step 2: Backing up database...${NC}"
docker-compose -f "$COMPOSE_FILE" up -d db
sleep 5
docker-compose -f "$COMPOSE_FILE" exec -T db pg_dump -U "${DB_USERNAME:-carevance}" -d "${DB_DATABASE:-carevance}" > "backup_$(date +%Y%m%d_%H%M%S).sql" || echo "Backup failed, continuing..."
docker-compose -f "$COMPOSE_FILE" down

echo -e "${YELLOW}Step 3: Pulling latest images...${NC}"
docker-compose -f "$COMPOSE_FILE" pull

echo -e "${YELLOW}Step 4: Starting services...${NC}"
docker-compose -f "$COMPOSE_FILE" up -d

echo -e "${YELLOW}Step 5: Waiting for database...${NC}"
sleep 10
until docker-compose -f "$COMPOSE_FILE" exec -T db pg_isready -U "${DB_USERNAME:-carevance}" -d "${DB_DATABASE:-carevance}" 2>/dev/null; do
    echo -e "${YELLOW}Waiting for database...${NC}"
    sleep 5
done

echo -e "${GREEN}Database is ready!${NC}"

echo -e "${YELLOW}Step 6: Running database migrations...${NC}"
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan migrate --force

echo -e "${YELLOW}Step 7: Clearing caches...${NC}"
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan cache:clear
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan config:clear
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan route:clear
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan view:clear

echo -e "${YELLOW}Step 8: Optimizing application...${NC}"
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan optimize
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan config:cache
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan route:cache
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan view:cache

echo -e "${YELLOW}Step 9: Restarting queue worker...${NC}"
docker-compose -f "$COMPOSE_FILE" restart queue

echo -e "${YELLOW}Step 10: Checking service status...${NC}"
docker-compose -f "$COMPOSE_FILE" ps

echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}Emergency fixes applied successfully!${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo "The following fixes have been applied:"
echo "1. ✅ Database indexes for screenshots, attendance, time_entries"
echo "2. ✅ Query limits (max 90 days for screenshots, max 3 months for calendar)"
echo "3. ✅ Error handling with try-catch blocks"
echo "4. ✅ Memory optimizations"
echo "5. ✅ Caching improvements"
echo ""
echo "Test the following pages:"
echo "- Monitoring/Screenshots"
echo "- Attendance Report"
echo "- Timesheet"
echo "- Timeline"
echo "- Web & App Usage"
echo ""
echo "If issues persist, check logs:"
echo "  docker-compose -f $COMPOSE_FILE logs -f backend"
echo ""
echo "To rollback if needed:"
echo "  docker-compose -f $COMPOSE_FILE exec backend php artisan migrate:rollback --step=1"
